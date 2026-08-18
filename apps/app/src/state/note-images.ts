export interface NoteImage {
  readonly id: string;
  readonly noteId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly dataUrl: string;
  readonly thumbnailDataUrl?: string;
  readonly createdAt: string;
}

export const NOTE_IMAGES_EVENT = 'minimed:note-images-changed';

export const THUMBNAIL_MAX_EDGE = 360;
export const THUMBNAIL_QUALITY = 0.7;

const DATABASE_NAME = 'minimed-note-images-v1';
const DATABASE_VERSION = 2;
const STORE_NAME = 'images';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

const listImageCache = new Map<string, ReadonlyMap<string, readonly NoteImage[]>>();

export function scaleThumbnailSize(
  width: number,
  height: number,
  maxEdge = THUMBNAIL_MAX_EDGE,
): { readonly width: number; readonly height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const largest = Math.max(width, height);
  if (largest <= maxEdge) return { width, height };
  const scale = maxEdge / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function noteImageListSrc(image: Pick<NoteImage, 'dataUrl' | 'thumbnailDataUrl'>): string {
  return image.thumbnailDataUrl ?? image.dataUrl;
}

function invalidateListCache(): void {
  listImageCache.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener(NOTE_IMAGES_EVENT, invalidateListCache);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
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

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Не удалось декодировать изображение.'));
    element.src = dataUrl;
  });
}

async function generateThumbnailDataUrl(dataUrl: string, mimeType: string): Promise<string> {
  const image = await loadImageElement(dataUrl);
  const { width, height } = scaleThumbnailSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить миниатюру.');
  context.drawImage(image, 0, 0, width, height);
  const outputType =
    mimeType === 'image/png' || mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return canvas.toDataURL(outputType, THUMBNAIL_QUALITY);
}

async function persistNoteImageRecord(record: NoteImage): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить изображение.'));
    });
  } finally {
    database.close();
  }
}

async function ensureThumbnail(record: NoteImage): Promise<NoteImage> {
  if (record.thumbnailDataUrl) return record;
  try {
    const thumbnailDataUrl = await generateThumbnailDataUrl(record.dataUrl, record.mimeType);
    const updated = { ...record, thumbnailDataUrl };
    await persistNoteImageRecord(updated);
    return updated;
  } catch {
    return record;
  }
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
      let thumbnailDataUrl: string | undefined;
      try {
        thumbnailDataUrl = await generateThumbnailDataUrl(dataUrl, file.type);
      } catch {
        thumbnailDataUrl = undefined;
      }
      return {
        id: imageId(),
        noteId,
        name: file.name,
        mimeType: file.type,
        dataUrl,
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
        reject(transaction.error ?? new Error('Не удалось сохранить изображения.'));
    });
  } finally {
    database.close();
  }
  invalidateListCache();
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

function listCacheKey(noteIds: readonly string[]): string {
  return [...noteIds].toSorted().join('\0');
}

async function backfillMissingThumbnails(
  records: readonly NoteImage[],
): Promise<readonly NoteImage[]> {
  const missing = records.filter((record) => !record.thumbnailDataUrl);
  if (missing.length === 0) return records;
  const updatedById = new Map<string, NoteImage>();
  for (const record of missing) {
    updatedById.set(record.id, await ensureThumbnail(record));
  }
  if (updatedById.size === 0) return records;
  return records.map((record) => updatedById.get(record.id) ?? record);
}

export async function loadNoteImagesForNotes(
  noteIds: readonly string[],
): Promise<ReadonlyMap<string, readonly NoteImage[]>> {
  if (noteIds.length === 0 || !('indexedDB' in globalThis) || !indexedDB) return new Map();
  const key = listCacheKey(noteIds);
  const cached = listImageCache.get(key);
  if (cached) return cached;

  const wanted = new Set(noteIds);
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
    const filtered = records
      .filter((record) => wanted.has(record.noteId))
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
    const withThumbnails = await backfillMissingThumbnails(filtered);
    const byNote = new Map<string, NoteImage[]>();
    for (const record of withThumbnails) {
      const existing = byNote.get(record.noteId);
      if (existing) existing.push(record);
      else byNote.set(record.noteId, [record]);
    }
    listImageCache.set(key, byNote);
    return byNote;
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
  invalidateListCache();
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
  invalidateListCache();
  window.dispatchEvent(new CustomEvent(NOTE_IMAGES_EVENT));
}
