import { FilingBrowser } from 'filing/dist/esm/browser/normal';
import archiveWasmUrl from 'filing/dist/esm/wasm/archive.wasm?url';

import {
  addUserLibraryFile,
  createUserLibraryFolder,
  getUserLibraryDocument,
  getUserLibraryFile,
  isUserLibraryArchive,
  listUserLibraryFolders,
  normalizeUserLibraryName,
  type UserLibraryFolder,
} from '@/state/user-library';
import {
  USER_LIBRARY_ARCHIVE_MAX_ENTRIES,
  USER_LIBRARY_ARCHIVE_MAX_ENTRY_BYTES,
  USER_LIBRARY_ARCHIVE_MAX_TOTAL_BYTES,
} from '@/state/user-library-zip';

type BrowserArchiveEntry = Awaited<ReturnType<FilingBrowser['extract']>>[number];

type RarWasmModule = typeof import('@minimed-rars-wasm');

let rarWasm: Promise<RarWasmModule> | undefined;

async function getRarWasm(): Promise<RarWasmModule> {
  if (rarWasm) return await rarWasm;
  rarWasm = import('@minimed-rars-wasm').then(async (module) => {
    await module.default();
    return module;
  });
  return await rarWasm;
}

export interface UserLibraryArchiveEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

let archiveExtractor: FilingBrowser | undefined;

function getArchiveExtractor(): FilingBrowser {
  if (!archiveExtractor) archiveExtractor = new FilingBrowser({ wasmUrl: archiveWasmUrl });
  return archiveExtractor;
}

function appendArchivePath(prefix: string, value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
  if (!prefix || !normalized || normalized === prefix || normalized.startsWith(`${prefix}/`)) {
    return normalized || prefix;
  }
  return `${prefix}/${normalized}`;
}

function safeArchiveParts(value: string): readonly string[] | null {
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  if (parts.some((part) => part.startsWith('._'))) return null;
  try {
    return parts.map((part, index) =>
      normalizeUserLibraryName(part, index === parts.length - 1 ? 'file' : 'folder'),
    );
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('длиннее')) throw cause;
    return null;
  }
}

function appendArchiveEntry(
  path: string,
  sourceData: ArrayLike<number>,
  output: UserLibraryArchiveEntry[],
  totalBytes: number,
): number {
  const parts = safeArchiveParts(path);
  if (!parts) return totalBytes;
  const data = Uint8Array.from(sourceData);
  if (data.byteLength > USER_LIBRARY_ARCHIVE_MAX_ENTRY_BYTES) {
    throw new Error('Архив содержит слишком большой файл.');
  }
  const total = totalBytes + data.byteLength;
  if (total > USER_LIBRARY_ARCHIVE_MAX_TOTAL_BYTES) {
    throw new Error('Общий размер распакованных файлов слишком велик.');
  }
  if (output.length >= USER_LIBRARY_ARCHIVE_MAX_ENTRIES) {
    throw new Error('В архиве слишком много файлов.');
  }
  output.push({ path: parts.join('/'), data });
  return total;
}

function collectArchiveEntries(
  source: readonly BrowserArchiveEntry[],
  output: UserLibraryArchiveEntry[],
  prefix = '',
  totalBytes = 0,
): number {
  let total = totalBytes;
  for (const entry of source) {
    const rawPath = entry.pathname || entry.filename;
    const path = appendArchivePath(prefix, rawPath);
    if (entry.type === 'DIR') {
      if (entry.children?.length)
        total = collectArchiveEntries(entry.children, output, path, total);
      continue;
    }
    if (entry.type !== 'FILE') continue;
    total = appendArchiveEntry(path, entry.data, output, total);
    if (entry.children?.length) total = collectArchiveEntries(entry.children, output, path, total);
  }
  return total;
}

async function extractRarArchive(
  blob: Blob,
  fileName: string,
): Promise<readonly UserLibraryArchiveEntry[]> {
  const { RarFile } = await getRarWasm();
  const archive = new RarFile(new Uint8Array(await blob.arrayBuffer()));
  try {
    const entries: UserLibraryArchiveEntry[] = [];
    let totalBytes = 0;
    for (const [index, entry] of archive.entries().entries()) {
      try {
        if (entry.isDirectory) continue;
        if (
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          entry.size > USER_LIBRARY_ARCHIVE_MAX_ENTRY_BYTES
        ) {
          throw new Error('Архив содержит слишком большой файл.');
        }
        if (entries.length >= USER_LIBRARY_ARCHIVE_MAX_ENTRIES) {
          throw new Error('В архиве слишком много файлов.');
        }
        if (totalBytes + entry.size > USER_LIBRARY_ARCHIVE_MAX_TOTAL_BYTES) {
          throw new Error('Общий размер распакованных файлов слишком велик.');
        }
        totalBytes = appendArchiveEntry(entry.name, archive.readAt(index), entries, totalBytes);
      } finally {
        entry.free();
      }
    }
    if (entries.length === 0) throw new Error(`Архив «${fileName}» не содержит файлов.`);
    return entries;
  } finally {
    archive.free();
  }
}

export async function extractUserLibraryArchive(
  fileName: string,
  blob: Blob,
): Promise<readonly UserLibraryArchiveEntry[]> {
  if (fileName.toLocaleLowerCase('ru-RU').endsWith('.rar')) {
    return await extractRarArchive(blob, fileName);
  }
  const extracted = await getArchiveExtractor().extract(blob);
  const entries: UserLibraryArchiveEntry[] = [];
  collectArchiveEntries(extracted, entries);
  if (entries.length === 0) throw new Error(`Архив «${fileName}» не содержит файлов.`);
  return entries;
}

function folderKey(parentId: string | null, title: string): string {
  return `${parentId ?? 'root'}\u0000${title}`;
}

export async function unpackUserLibraryArchive(
  documentId: string,
): Promise<{ readonly files: number; readonly folders: number }> {
  const archive = await getUserLibraryDocument(documentId);
  if (!archive || !isUserLibraryArchive(archive.fileName)) {
    throw new Error('Этот файл нельзя распаковать.');
  }
  const blob = await getUserLibraryFile(documentId);
  if (!blob) throw new Error('Архив недоступен.');
  const entries = await extractUserLibraryArchive(archive.fileName, blob);
  const knownFolders = await listUserLibraryFolders();
  const folderIds = new Map(
    knownFolders.map((folder) => [folderKey(folder.parentId, folder.title), folder.id]),
  );
  const targetFolderId = archive.folderId ?? null;
  let createdFolders = 0;
  let createdFiles = 0;

  for (const entry of entries) {
    const parts = entry.path.split('/');
    const fileName = parts.pop();
    if (!fileName) continue;
    let parentId = targetFolderId;
    for (const title of parts) {
      const key = folderKey(parentId, title);
      let folderId = folderIds.get(key);
      if (!folderId) {
        const folder: UserLibraryFolder = await createUserLibraryFolder(title, parentId);
        folderId = folder.id;
        folderIds.set(key, folderId);
        createdFolders += 1;
      }
      parentId = folderId;
    }
    await addUserLibraryFile(new File([entry.data.buffer as ArrayBuffer], fileName), parentId);
    createdFiles += 1;
  }

  return { files: createdFiles, folders: createdFolders };
}
