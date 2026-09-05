import { attachmentThumbnails } from '@/state/thumbnails';

export interface NoteFile {
  readonly id: string;
  readonly noteId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly blob: Blob;
  readonly thumbnailDataUrl?: string;
  readonly createdAt: string;
}

export const NOTE_FILES_EVENT = 'minimed:note-files-changed';

const DATABASE_NAME = 'minimed-note-files-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'files';
export const MAX_NOTE_FILE_BYTES = 64 * 1024 * 1024;

const listFilesCache = new Map<string, ReadonlyMap<string, readonly NoteFile[]>>();
const objectUrlCache = new Map<string, string>();

function scheduleLibrarySync(): void {
  void import('@/state/note-library-sync')
    .then(({ schedulePatientNotesLibrarySync }) => schedulePatientNotesLibrarySync())
    .catch((cause) => {
      console.warn(
        cause instanceof Error
          ? `Не удалось подключить синхронизацию вложений: ${cause.message}`
          : 'Не удалось подключить синхронизацию вложений.',
      );
    });
}

export function invalidateNoteFileCache(): void {
  listFilesCache.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener(NOTE_FILES_EVENT, () => {
    invalidateNoteFileCache();
    for (const [id, url] of objectUrlCache) {
      URL.revokeObjectURL(url);
      objectUrlCache.delete(id);
    }
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('noteId', 'noteId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть хранилище файлов.'));
  });
}

function validateFile(file: File): void {
  if (file.size === 0) throw new Error(`Файл «${file.name}» пустой.`);
  if (file.size > MAX_NOTE_FILE_BYTES) {
    throw new Error(`Файл «${file.name}» больше 64 МБ.`);
  }
}

/** Stable blob: URL for previews and viewers; revoked when the store changes. */
export function noteFileSrc(record: Pick<NoteFile, 'id' | 'blob'>): string {
  let url = objectUrlCache.get(record.id);
  if (!url) {
    url = URL.createObjectURL(record.blob);
    objectUrlCache.set(record.id, url);
  }
  return url;
}

export async function addNoteFiles(
  noteId: string,
  files: readonly File[],
): Promise<readonly NoteFile[]> {
  if (!noteId || files.length === 0) return [];
  if (!('indexedDB' in globalThis) || !indexedDB) {
    throw new Error('Хранилище файлов недоступно.');
  }
  for (const file of files) validateFile(file);

  const records = await Promise.all(
    files.map(async (file): Promise<NoteFile> => {
      let thumbnailDataUrl: string | undefined;
      try {
        thumbnailDataUrl = await attachmentThumbnails.forFile(file, file.type || '', file.name);
      } catch {
        thumbnailDataUrl = undefined;
      }
      return {
        id: `file-${crypto.randomUUID()}`,
        noteId,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        blob: file,
        ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
        createdAt: new Date().toISOString(),
      };
    }),
  );

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      for (const record of records) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить файлы.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(NOTE_FILES_EVENT));
  scheduleLibrarySync();
  return records;
}

/** Replaces an attachment in one transaction; the new blob is written before the old one is removed. */
export async function replaceNoteFile(fileId: string, file: File): Promise<NoteFile> {
  if (!fileId) throw new Error('Неизвестное вложение.');
  if (!('indexedDB' in globalThis) || !indexedDB) {
    throw new Error('Хранилище файлов недоступно.');
  }
  validateFile(file);
  let thumbnailDataUrl: string | undefined;
  try {
    thumbnailDataUrl = await attachmentThumbnails.forFile(file, file.type || '', file.name);
  } catch {
    thumbnailDataUrl = undefined;
  }

  const database = await openDatabase();
  let replacement: NoteFile | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      let failed = false;
      const fail = (cause: unknown): void => {
        if (failed) return;
        failed = true;
        reject(cause instanceof Error ? cause : new Error('Не удалось обновить файл.'));
      };
      const request = store.get(fileId);
      request.onsuccess = () => {
        const previous = request.result as NoteFile | undefined;
        if (!previous) {
          fail(new Error('Вложение уже удалено.'));
          transaction.abort();
          return;
        }
        replacement = {
          id: `file-${crypto.randomUUID()}`,
          noteId: previous.noteId,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          blob: file,
          ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
          createdAt: new Date().toISOString(),
        };
        // Keep the original until the replacement has been accepted by the same transaction.
        store.put(replacement);
        store.delete(fileId);
      };
      request.onerror = () => fail(request.error ?? new Error('Не удалось прочитать файл.'));
      transaction.oncomplete = () => {
        if (replacement) resolve();
        else fail(new Error('Не удалось обновить файл.'));
      };
      transaction.onerror = () => fail(transaction.error ?? new Error('Не удалось обновить файл.'));
      transaction.onabort = () => fail(new Error('Не удалось обновить файл.'));
    });
  } finally {
    database.close();
  }
  if (!replacement) throw new Error('Не удалось обновить файл.');
  window.dispatchEvent(new Event(NOTE_FILES_EVENT));
  scheduleLibrarySync();
  return replacement;
}

async function loadByNoteIds(
  noteIds: readonly string[],
): Promise<ReadonlyMap<string, readonly NoteFile[]>> {
  const wanted = new Set(noteIds.filter(Boolean));
  const cacheKey = [...wanted].toSorted().join('|');
  const cached = listFilesCache.get(cacheKey);
  if (cached) return cached;

  if (!('indexedDB' in globalThis) || !indexedDB || wanted.size === 0) {
    return new Map();
  }
  const database = await openDatabase();
  try {
    const grouped = new Map<string, NoteFile[]>();
    for (const noteId of wanted) grouped.set(noteId, []);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value as NoteFile;
        const bucket = grouped.get(record.noteId);
        if (bucket) bucket.push(record);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось загрузить файлы.'));
    });
    for (const bucket of grouped.values()) {
      bucket.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    const result = new Map<string, readonly NoteFile[]>(
      [...grouped].map(([noteId, bucket]) => [noteId, bucket]),
    );
    listFilesCache.set(cacheKey, result);
    return result;
  } finally {
    database.close();
  }
}

export async function loadNoteFiles(noteId: string): Promise<readonly NoteFile[]> {
  return (await loadByNoteIds([noteId])).get(noteId) ?? [];
}

export async function loadNoteFilesForNotes(
  noteIds: readonly string[],
): Promise<ReadonlyMap<string, readonly NoteFile[]>> {
  return loadByNoteIds(noteIds);
}

export async function deleteNoteFile(fileId: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(fileId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить файл.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(NOTE_FILES_EVENT));
  scheduleLibrarySync();
}

export async function deleteNoteFilesForNotes(noteIds: readonly string[]): Promise<void> {
  if (noteIds.length === 0) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const index = transaction.objectStore(STORE_NAME).index('noteId');
      const request = index.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (noteIds.includes(cursor.value.noteId)) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить файлы.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(NOTE_FILES_EVENT));
  scheduleLibrarySync();
}

/** Save a stored attachment back to the user's machine (web download). */
export function downloadNoteFile(record: NoteFile): void {
  const url = noteFileSrc(record);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = record.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
