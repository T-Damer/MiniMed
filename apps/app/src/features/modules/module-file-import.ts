import {
  type ContentModuleCatalogEntry,
  ContentModuleCatalogEntrySchema,
  hasDownloadableModuleIndex,
  isLocalModuleArtifactUrl,
  LOCAL_MODULE_URL_SCHEME,
} from '@localmed/contracts';
import { BlobZipReader, ZipReadError } from '@/features/modules/module-bundle-zip';

/**
 * Installing a module from a file: `<stem>.minimed-module.zip` holds `module.json` (one complete
 * catalog entry whose artifact URLs read `minimed-local:<path-in-zip>`) and each artifact at that
 * path, stored without compression. Built by `medbase bundle-local-module`; see
 * docs/CONTENT_MODULES.md. The bytes then go through the ordinary install path (checksum, decode,
 * OPFS, registry, mount) in place of a download.
 */
export const MODULE_BUNDLE_ENTRY_FILE = 'module.json';
export const MODULE_BUNDLE_ACCEPT = '.zip,application/zip';

const MAX_MODULE_JSON_BYTES = 64 * 1024 * 1024;

type ModuleArtifact = ContentModuleCatalogEntry['artifacts'][number];

/** The message is Russian and short enough for a toast. */
export class ModuleFileImportError extends Error {
  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'ModuleFileImportError';
  }
}

export interface OpenedModuleBundle {
  readonly entry: ContentModuleCatalogEntry;
  readonly fileName: string;
  /** Reads one artifact's bytes from the file. */
  readonly readArtifact: (artifact: ModuleArtifact) => Promise<Uint8Array>;
}

const SUPPORTED_COMPRESSION: Readonly<Record<ModuleArtifact['kind'], readonly string[]>> = {
  index: ['none', 'gzip', 'zstd'],
  'source-assets': ['zip'],
};

/** The ZIP path an artifact URL names, or null when the URL does not point into the bundle. */
export function bundleArtifactPath(url: string | null): string | null {
  if (!isLocalModuleArtifactUrl(url) || url === null) return null;
  const path = url.slice(LOCAL_MODULE_URL_SCHEME.length);
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return null;
  }
  return path;
}

function zipErrorMessage(cause: ZipReadError): string {
  switch (cause.failure) {
    case 'not-a-zip':
      return 'Это не файл модуля MiniMed.';
    case 'compressed':
      return 'Архив модуля сжат: пересоберите его без сжатия.';
    case 'encrypted':
      return 'Архив модуля зашифрован.';
    case 'unsupported-zip64':
      return 'Файл модуля слишком большой.';
    case 'entry-missing':
      return 'В файле модуля не хватает данных.';
    case 'corrupt':
      return 'Файл модуля повреждён.';
  }
}

async function readModuleJson(zip: BlobZipReader): Promise<unknown> {
  const size = zip.size(MODULE_BUNDLE_ENTRY_FILE);
  if (size === null) throw new ModuleFileImportError('В файле нет описания модуля.');
  if (size > MAX_MODULE_JSON_BYTES)
    throw new ModuleFileImportError('Описание модуля слишком велико.');
  const bytes = await zip.read(MODULE_BUNDLE_ENTRY_FILE);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (cause) {
    throw new ModuleFileImportError('Описание модуля повреждено.', { cause });
  }
}

function assertInstallable(entry: ContentModuleCatalogEntry, zip: BlobZipReader): void {
  if (entry.required || entry.kind === 'core') {
    throw new ModuleFileImportError('Ядро нельзя заменить файлом.');
  }
  if (entry.releaseState !== 'published' && entry.releaseState !== 'preview') {
    throw new ModuleFileImportError('Модуль не готов к установке.');
  }
  if (!hasDownloadableModuleIndex(entry)) {
    throw new ModuleFileImportError('В модуле нет проверяемой базы.');
  }
  for (const artifact of entry.artifacts) {
    if (!SUPPORTED_COMPRESSION[artifact.kind].includes(artifact.compression)) {
      throw new ModuleFileImportError('Формат файла модуля не поддерживается.');
    }
    const path = bundleArtifactPath(artifact.url);
    if (path === null) {
      throw new ModuleFileImportError('Файл модуля ссылается на внешний адрес.');
    }
    if (!artifact.sha256 || artifact.sizeBytes === null) {
      throw new ModuleFileImportError('В описании модуля нет контрольной суммы.');
    }
    const stored = zip.size(path);
    if (stored === null) throw new ModuleFileImportError('В файле модуля не хватает данных.');
    if (stored !== artifact.sizeBytes) {
      throw new ModuleFileImportError('Размер данных не совпадает с описанием модуля.');
    }
  }
}

/**
 * Opens and validates a bundle without reading its artifacts: the ZIP directory, `module.json`
 * against the catalog entry schema, and that every artifact is present with the declared size.
 * Checksums are verified by the installer while the artifact is installed.
 */
export async function openModuleBundle(file: Blob, fileName = ''): Promise<OpenedModuleBundle> {
  let zip: BlobZipReader;
  try {
    zip = await BlobZipReader.open(file);
  } catch (cause) {
    if (cause instanceof ZipReadError) {
      throw new ModuleFileImportError(zipErrorMessage(cause), { cause });
    }
    throw cause;
  }
  let entry: ContentModuleCatalogEntry;
  try {
    const parsed = ContentModuleCatalogEntrySchema.safeParse(await readModuleJson(zip));
    if (!parsed.success) {
      throw new ModuleFileImportError('Описание модуля не прошло проверку.', {
        cause: parsed.error,
      });
    }
    entry = parsed.data;
    assertInstallable(entry, zip);
  } catch (cause) {
    if (cause instanceof ZipReadError) {
      throw new ModuleFileImportError(zipErrorMessage(cause), { cause });
    }
    throw cause;
  }
  return {
    entry,
    fileName,
    readArtifact: async (artifact) => {
      const path = bundleArtifactPath(artifact.url);
      if (path === null) throw new ModuleFileImportError('Файл модуля ссылается на внешний адрес.');
      try {
        return await zip.read(path);
      } catch (cause) {
        if (cause instanceof ZipReadError) {
          throw new ModuleFileImportError(zipErrorMessage(cause), { cause });
        }
        throw cause;
      }
    },
  };
}

/**
 * Whether an opened bundle may be installed now: its id must not belong to a public module (those
 * update from the catalog, never from a file), and the same build must not already be installed.
 */
export function assertBundleCanInstall(
  entry: ContentModuleCatalogEntry,
  publicCatalog: { readonly modules: readonly { readonly id: string }[] },
  installed:
    | { readonly version: string; readonly activeSourceSetDigest: string | null }
    | null
    | undefined,
): void {
  if (publicCatalog.modules.some((module) => module.id === entry.id)) {
    throw new ModuleFileImportError('Такой модуль уже есть в каталоге MiniMed.');
  }
  if (
    installed &&
    installed.version === entry.version &&
    installed.activeSourceSetDigest === entry.sourceSetDigest
  ) {
    throw new ModuleFileImportError('Этот модуль уже установлен.');
  }
}

/**
 * A short Russian message for an installer failure (its text is English or technical). Messages
 * that are already Russian pass through.
 */
export function describeModuleImportFailure(message: string | null | undefined): string {
  const text = message ?? '';
  if (/checksum mismatch/iu.test(text) || /size\/checksum mismatch/iu.test(text)) {
    return 'Контрольная сумма не совпала: файл повреждён.';
  }
  if (/size mismatch/iu.test(text)) return 'Размер данных не совпадает с описанием модуля.';
  if (/requires MiniMed|not compatible with MiniMed/iu.test(text)) {
    return 'Модуль требует другой версии приложения.';
  }
  if (/requires schema|core catalog/iu.test(text)) {
    return 'Формат базы модуля не подходит этой версии приложения.';
  }
  if (/dependency/iu.test(text)) return 'Сначала установите модули, которые нужны этому.';
  if (/validation failed|не прошла проверку/iu.test(text)) {
    return 'База модуля не прошла проверку целостности.';
  }
  if (/[А-Яа-яЁё]/u.test(text)) return text;
  return 'Не удалось установить модуль из файла.';
}
