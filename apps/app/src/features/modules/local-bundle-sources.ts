import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import {
  ModuleFileImportError,
  type OpenedModuleBundle,
} from '@/features/modules/module-file-import';
import { moduleVersionKey } from '@/features/modules/module-opfs-pools';

type ModuleArtifact = ContentModuleCatalogEntry['artifacts'][number];

/**
 * Bundles chosen from a file, by `moduleId@version`, for the length of their installation: the
 * installer asks here for `minimed-local:` artifacts instead of fetching them. A remote catalog
 * cannot reach this map, and a local URL without a registered bundle fails.
 */
const bundles = new Map<string, OpenedModuleBundle>();

export function registerLocalBundle(bundle: OpenedModuleBundle): void {
  bundles.set(moduleVersionKey(bundle.entry.id, bundle.entry.version), bundle);
}

export function releaseLocalBundle(moduleId: string, version: string): void {
  bundles.delete(moduleVersionKey(moduleId, version));
}

/** The downloader of a local artifact: the bytes come out of the registered file. */
export async function downloadLocalBundleArtifact(
  artifact: ModuleArtifact,
  signal: AbortSignal,
  onProgress: (progress: { downloadedBytes: number; totalBytes: number | null }) => void,
  module?: Pick<ContentModuleCatalogEntry, 'id' | 'version'>,
): Promise<Uint8Array> {
  const bundle = module ? bundles.get(moduleVersionKey(module.id, module.version)) : undefined;
  if (!bundle) throw new ModuleFileImportError('Файл модуля недоступен: выберите его снова.');
  signal.throwIfAborted();
  const bytes = await bundle.readArtifact(artifact);
  signal.throwIfAborted();
  onProgress({ downloadedBytes: bytes.byteLength, totalBytes: bytes.byteLength });
  return bytes;
}
