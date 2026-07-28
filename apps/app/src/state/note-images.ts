export interface NoteImage {
  readonly id: string;
  readonly noteId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly dataUrl: string;
  readonly createdAt: string;
}

export const NOTE_IMAGES_EVENT = 'minimed:note-images-changed';

const DATABASE_NAME = 'minimed-note-images-v1';
const STORE_NAME = 'images';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть изображения.'));
  });
}

function imageId(): string {
  return `image-${crypto.randomUUID()}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Не удалось прочитать изображение.'));
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать изображение.'));
    reader.readAsDataURL(file);
  });
}

function validateFile(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Поддерживаются изображения JPEG, PNG, WebP и GIF.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Размер одного изображения не должен превышать 8 МБ.');
  }
}

export async function addNoteImages(
  noteId: string,
  files: readonly File[],
): Promise<readonly NoteImage[]> {
  if (!noteId || files.length === 0) return [];
  if (!('indexedDB' in globalThis) || !indexedDB) {
    throw new Error('Хранилище изображений недоступно.');
  }
  const records = await Promise.all(
    files.map(async (file): Promise<NoteImage> => {
      validateFile(file);
      const dataUrl = await readAsDataUrl(file);
      if (!dataUrl.startsWith(`data:${file.type};base64,`)) {
        throw new Error('Формат изображения не удалось проверить.');
      }
      return {
        id: imageId(),
        noteId,
        name: file.name,
        mimeType: file.type,
        dataUrl,
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
        reject(transaction.error ?? new Error('Не удалось сохранить изображения.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new CustomEvent(NOTE_IMAGES_EVENT, { detail: { noteId } }));
  return records;
}

export async function loadNoteImages(noteId: string): Promise<readonly NoteImage[]> {
  if (!noteId || !('indexedDB' in globalThis) || !indexedDB) return [];
  const database = await openDatabase();
  try {
    const records = await new Promise<readonly NoteImage[]>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .getAll() as IDBRequest<NoteImage[]>;
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Не удалось загрузить изображения.'));
    });
    return records
      .filter((record) => record.noteId === noteId)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  } finally {
    database.close();
  }
}

export async function deleteNoteImage(imageIdValue: string): Promise<void> {
  if (!imageIdValue || !('indexedDB' in globalThis) || !indexedDB) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(imageIdValue);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить изображение.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new CustomEvent(NOTE_IMAGES_EVENT));
}

export async function deleteNoteImagesForNotes(noteIds: readonly string[]): Promise<void> {
  if (noteIds.length === 0 || !('indexedDB' in globalThis) || !indexedDB) return;
  const doomed = new Set(noteIds);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll() as IDBRequest<NoteImage[]>;
      request.onsuccess = () => {
        for (const record of request.result) {
          if (doomed.has(record.noteId)) store.delete(record.id);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Не удалось удалить изображения.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить изображения.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new CustomEvent(NOTE_IMAGES_EVENT));
}
