import {
  personalMatchScore,
  personalQueryStems,
  wordMatchesQueryStem,
} from '@/state/personal-stem-match';
import { validateUserLibraryFile } from '@/state/user-library-formats';

export type UserLibraryOcrStatus = 'inspecting' | 'ready' | 'ocr' | 'failed';
export type UserLibraryOcrQuality = 'fast' | 'balanced' | 'quality';

export interface UserLibraryDocument {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly pageCount: number;
  readonly nativeTextPages: number;
  readonly ocrDonePages: number;
  readonly ocrNeededPages: number;
  readonly status: UserLibraryOcrStatus;
  readonly folderId?: string | null;
  readonly hasImages?: boolean;
  readonly ocrPriority?: number;
  readonly ocrQuality?: UserLibraryOcrQuality;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt?: string;
}

export interface UserLibraryFolder {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserLibraryWordBox {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface UserLibraryPage {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: 'native' | 'ocr' | 'pending' | 'empty';
  readonly text: string;
  readonly words?: readonly UserLibraryWordBox[];
}

export interface UserLibraryMatch {
  readonly document: UserLibraryDocument;
  readonly pageIndex: number;
  readonly score: number;
  readonly snippet: string;
}

export const USER_LIBRARY_EVENT = 'minimed:user-library-changed';

const DATABASE_NAME = 'minimed-user-library-v1';
const DOCUMENTS_STORE = 'documents';
const FILES_STORE = 'files';
const PAGES_STORE = 'pages';
const FOLDERS_STORE = 'folders';
const DATABASE_VERSION = 2;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_SNIPPET_LENGTH = 180;

const PDF_MIME_TYPES = new Set(['application/pdf']);

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
]);

const TEXT_LIKE_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/rtf',
  'application/rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.apple.pages',
  'text/html',
  'text/csv',
  'application/epub+zip',
  'application/x-fictionbook+xml',
]);

const ALLOWED_MIME_TYPES = new Set([
  ...PDF_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
  ...TEXT_LIKE_MIME_TYPES,
]);

const EXTENSION_MIME_MAP: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  rtf: 'text/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  pages: 'application/vnd.apple.pages',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  epub: 'application/epub+zip',
  fb2: 'application/x-fictionbook+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
};

export function isUserLibraryPdfMime(mime: string): boolean {
  return PDF_MIME_TYPES.has(mime);
}

export function isUserLibraryImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime);
}

export function isUserLibraryVisualMime(mime: string): boolean {
  return isUserLibraryPdfMime(mime) || isUserLibraryImageMime(mime);
}

export function isUserLibraryTextLikeMime(mime: string): boolean {
  return TEXT_LIKE_MIME_TYPES.has(mime);
}

export function userLibraryFileAccept(): string {
  const extensions = Object.keys(EXTENSION_MIME_MAP)
    .map((ext) => `.${ext}`)
    .join(',');
  const mimeTypes = [...ALLOWED_MIME_TYPES].join(',');
  return `${extensions},${mimeTypes}`;
}

export type UserLibraryFileKind =
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'presentation'
  | 'sheet'
  | 'doc'
  | 'ebook'
  | 'text'
  | 'binary';

const FILE_KIND_BY_EXTENSION: Readonly<Record<string, UserLibraryFileKind>> = {
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  heic: 'image',
  heif: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  avi: 'video',
  mkv: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  flac: 'audio',
  zip: 'archive',
  '7z': 'archive',
  rar: 'archive',
  dmg: 'archive',
  json: 'code',
  xml: 'code',
  js: 'code',
  ts: 'code',
  ppt: 'presentation',
  pptx: 'presentation',
  xls: 'sheet',
  xlsx: 'sheet',
  csv: 'sheet',
  doc: 'doc',
  docx: 'doc',
  pages: 'doc',
  epub: 'ebook',
  fb2: 'ebook',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  rtf: 'text',
  exe: 'binary',
  msi: 'binary',
};

export function userLibraryFileKind(mime: string, fileName: string): UserLibraryFileKind {
  const byExtension = FILE_KIND_BY_EXTENSION[extensionOf(fileName)];
  if (byExtension) return byExtension;
  if (isUserLibraryPdfMime(mime)) return 'pdf';
  if (isUserLibraryImageMime(mime)) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/')) return 'text';
  return 'binary';
}

function isFiniteUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function sanitizeWordBoxes(words: unknown): readonly UserLibraryWordBox[] | undefined {
  if (!Array.isArray(words)) return undefined;
  const sanitized: UserLibraryWordBox[] = [];
  for (const item of words) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<UserLibraryWordBox>;
    if (
      typeof candidate.text !== 'string' ||
      !candidate.text.trim() ||
      !isFiniteUnit(candidate.x) ||
      !isFiniteUnit(candidate.y) ||
      !isFiniteUnit(candidate.w) ||
      !isFiniteUnit(candidate.h)
    ) {
      continue;
    }
    sanitized.push({
      text: candidate.text,
      x: candidate.x,
      y: candidate.y,
      w: candidate.w,
      h: candidate.h,
    });
  }
  return sanitized.length > 0 ? sanitized : undefined;
}

function normalizePage(page: UserLibraryPage): UserLibraryPage {
  if (!page.words) return page;
  const words = sanitizeWordBoxes(page.words);
  if (!words) {
    const { words: _ignored, ...rest } = page;
    return rest;
  }
  return { ...page, words };
}

function pageKey(documentId: string, pageIndex: number): string {
  return `${documentId}:${pageIndex}`;
}

function createDocumentId(): string {
  return `user-doc-${crypto.randomUUID()}`;
}

function createFolderId(): string {
  return `user-folder-${crypto.randomUUID()}`;
}

function snippetFor(text: string, queryStems: readonly string[]): string {
  const words = text.split(/\s+/u);
  const hitIndex = words.findIndex((word) => wordMatchesQueryStem(word, queryStems));
  if (hitIndex < 0) {
    return text.length <= MAX_SNIPPET_LENGTH ? text : `${text.slice(0, MAX_SNIPPET_LENGTH - 1)}…`;
  }
  const start = Math.max(0, hitIndex - 6);
  const snippet = words.slice(start, start + 18).join(' ');
  const prefix = start > 0 ? '…' : '';
  const suffix = start + 18 < words.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
}

function isOcrQuality(value: unknown): value is UserLibraryOcrQuality {
  return value === 'fast' || value === 'balanced' || value === 'quality';
}

function isDocument(value: unknown): value is UserLibraryDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserLibraryDocument>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.byteLength === 'number' &&
    typeof candidate.pageCount === 'number' &&
    typeof candidate.nativeTextPages === 'number' &&
    typeof candidate.ocrDonePages === 'number' &&
    typeof candidate.ocrNeededPages === 'number' &&
    (candidate.folderId === undefined ||
      candidate.folderId === null ||
      typeof candidate.folderId === 'string') &&
    (candidate.hasImages === undefined || typeof candidate.hasImages === 'boolean') &&
    (candidate.ocrPriority === undefined || typeof candidate.ocrPriority === 'number') &&
    (candidate.ocrQuality === undefined || isOcrQuality(candidate.ocrQuality)) &&
    (candidate.status === 'inspecting' ||
      candidate.status === 'ready' ||
      candidate.status === 'ocr' ||
      candidate.status === 'failed') &&
    (candidate.lastOpenedAt === undefined || typeof candidate.lastOpenedAt === 'string')
  );
}

function isFolder(value: unknown): value is UserLibraryFolder {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserLibraryFolder>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    (candidate.parentId === null || typeof candidate.parentId === 'string') &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function isPage(value: unknown): value is UserLibraryPage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserLibraryPage>;
  if (
    typeof candidate.documentId !== 'string' ||
    typeof candidate.pageIndex !== 'number' ||
    (candidate.kind !== 'native' &&
      candidate.kind !== 'ocr' &&
      candidate.kind !== 'pending' &&
      candidate.kind !== 'empty') ||
    typeof candidate.text !== 'string'
  ) {
    return false;
  }
  if (candidate.words !== undefined && !Array.isArray(candidate.words)) return false;
  return true;
}

function extensionOf(fileName: string): string {
  const lower = fileName.toLocaleLowerCase('ru-RU');
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot + 1) : '';
}

function normalizeMimeType(file: File): string {
  const extension = extensionOf(file.name);
  const mapped = EXTENSION_MIME_MAP[extension];
  if (mapped) return mapped;
  if (file.type && ALLOWED_MIME_TYPES.has(file.type)) return file.type;
  if (extension === 'xml' && (file.type === 'text/xml' || file.type === 'application/xml')) {
    return 'application/x-fictionbook+xml';
  }
  return file.type;
}

function validateFile(file: File): string {
  // Любой тип файла разрешён: нераспознанные хранятся как «документ-файл»
  // с иконкой по расширению и скачиванием вместо читалки.
  const mimeType = normalizeMimeType(file);
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Размер файла не должен превышать 128 МБ.');
  }
  return mimeType;
}

function emitLibraryChanged(): void {
  window.dispatchEvent(new CustomEvent(USER_LIBRARY_EVENT));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(FILES_STORE)) {
        database.createObjectStore(FILES_STORE);
      }
      if (!database.objectStoreNames.contains(PAGES_STORE)) {
        database.createObjectStore(PAGES_STORE);
      }
      if (!database.objectStoreNames.contains(FOLDERS_STORE)) {
        database.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть личную библиотеку.'));
  });
}

async function readAllDocuments(database: IDBDatabase): Promise<readonly UserLibraryDocument[]> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(DOCUMENTS_STORE, 'readonly')
      .objectStore(DOCUMENTS_STORE)
      .getAll() as IDBRequest<UserLibraryDocument[]>;
    request.onsuccess = () => resolve(request.result.filter(isDocument));
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось прочитать личные документы.'));
  });
}

async function readAllFolders(database: IDBDatabase): Promise<readonly UserLibraryFolder[]> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(FOLDERS_STORE, 'readonly')
      .objectStore(FOLDERS_STORE)
      .getAll() as IDBRequest<UserLibraryFolder[]>;
    request.onsuccess = () => resolve(request.result.filter(isFolder));
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать папки.'));
  });
}

async function readAllPages(database: IDBDatabase): Promise<readonly UserLibraryPage[]> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(PAGES_STORE, 'readonly')
      .objectStore(PAGES_STORE)
      .getAll() as IDBRequest<UserLibraryPage[]>;
    request.onsuccess = () => {
      resolve(request.result.filter(isPage).map((page) => normalizePage(page)));
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось прочитать страницы личных документов.'));
  });
}

export async function listUserLibraryDocuments(): Promise<readonly UserLibraryDocument[]> {
  if (!('indexedDB' in globalThis) || !indexedDB) return [];
  const database = await openDatabase();
  try {
    const documents = await readAllDocuments(database);
    return documents.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
}

export async function listUserLibraryFolders(): Promise<readonly UserLibraryFolder[]> {
  if (!('indexedDB' in globalThis) || !indexedDB) return [];
  const database = await openDatabase();
  try {
    return (await readAllFolders(database)).toSorted((left, right) =>
      left.title.localeCompare(right.title, 'ru-RU'),
    );
  } finally {
    database.close();
  }
}

export async function getUserLibraryDocument(id: string): Promise<UserLibraryDocument | null> {
  if (!id || !('indexedDB' in globalThis) || !indexedDB) return null;
  const database = await openDatabase();
  try {
    const document = await new Promise<UserLibraryDocument | undefined>((resolve, reject) => {
      const request = database
        .transaction(DOCUMENTS_STORE, 'readonly')
        .objectStore(DOCUMENTS_STORE)
        .get(id) as IDBRequest<UserLibraryDocument | undefined>;
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Не удалось прочитать личный документ.'));
    });
    return document && isDocument(document) ? document : null;
  } finally {
    database.close();
  }
}

export async function getUserLibraryFile(id: string): Promise<Blob | null> {
  if (!id || !('indexedDB' in globalThis) || !indexedDB) return null;
  const database = await openDatabase();
  try {
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = database
        .transaction(FILES_STORE, 'readonly')
        .objectStore(FILES_STORE)
        .get(id) as IDBRequest<Blob | undefined>;
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Не удалось прочитать файл личного документа.'));
    });
    return blob ?? null;
  } finally {
    database.close();
  }
}

export async function listUserLibraryPages(
  documentId: string,
): Promise<readonly UserLibraryPage[]> {
  if (!documentId || !('indexedDB' in globalThis) || !indexedDB) return [];
  const database = await openDatabase();
  try {
    const pages = await readAllPages(database);
    return pages
      .filter((page) => page.documentId === documentId)
      .toSorted((left, right) => left.pageIndex - right.pageIndex);
  } finally {
    database.close();
  }
}

export async function createUserLibraryFolder(
  title: string,
  parentId: string | null = null,
): Promise<UserLibraryFolder> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Введите название папки.');
  const now = new Date().toISOString();
  const folder: UserLibraryFolder = {
    id: createFolderId(),
    title: trimmed,
    parentId,
    createdAt: now,
    updatedAt: now,
  };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(FOLDERS_STORE, 'readwrite');
      transaction.objectStore(FOLDERS_STORE).put(folder);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось создать папку.'));
    });
  } finally {
    database.close();
  }
  emitLibraryChanged();
  return folder;
}

export async function renameUserLibraryFolder(id: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const folders = await listUserLibraryFolders();
  const existing = folders.find((folder) => folder.id === id);
  if (!existing) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(FOLDERS_STORE, 'readwrite');
      transaction.objectStore(FOLDERS_STORE).put({
        ...existing,
        title: trimmed,
        updatedAt: new Date().toISOString(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось переименовать папку.'));
    });
  } finally {
    database.close();
  }
  emitLibraryChanged();
}

export async function moveUserLibraryFolder(id: string, parentId: string | null): Promise<void> {
  if (id === parentId) return;
  const folders = await listUserLibraryFolders();
  const existing = folders.find((folder) => folder.id === id);
  if (!existing) return;
  let cursor = parentId;
  while (cursor) {
    if (cursor === id) throw new Error('Нельзя переместить папку внутрь самой себя.');
    cursor = folders.find((folder) => folder.id === cursor)?.parentId ?? null;
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(FOLDERS_STORE, 'readwrite');
      transaction.objectStore(FOLDERS_STORE).put({
        ...existing,
        parentId,
        updatedAt: new Date().toISOString(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось переместить папку.'));
    });
  } finally {
    database.close();
  }
  emitLibraryChanged();
}

export async function removeUserLibraryFolder(id: string): Promise<void> {
  const folders = await listUserLibraryFolders();
  const folder = folders.find((item) => item.id === id);
  if (!folder) return;
  const documents = await listUserLibraryDocuments();
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([FOLDERS_STORE, DOCUMENTS_STORE], 'readwrite');
      const folderStore = transaction.objectStore(FOLDERS_STORE);
      const documentStore = transaction.objectStore(DOCUMENTS_STORE);
      folderStore.delete(id);
      for (const child of folders.filter((candidate) => candidate.parentId === id)) {
        folderStore.put({
          ...child,
          parentId: folder.parentId,
          updatedAt: new Date().toISOString(),
        });
      }
      for (const document of documents.filter((candidate) => candidate.folderId === id)) {
        documentStore.put({
          ...document,
          folderId: folder.parentId,
          updatedAt: new Date().toISOString(),
        });
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить папку.'));
    });
  } finally {
    database.close();
  }
  emitLibraryChanged();
}

export async function renameUserLibraryDocument(id: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const database = await openDatabase();
  try {
    const existing = await getUserLibraryDocument(id);
    if (!existing) return;
    const updated: UserLibraryDocument = {
      ...existing,
      title: trimmed,
      updatedAt: new Date().toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
      transaction.objectStore(DOCUMENTS_STORE).put(updated);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось переименовать документ.'));
    });
    emitLibraryChanged();
  } finally {
    database.close();
  }
}

export async function moveUserLibraryDocument(id: string, folderId: string | null): Promise<void> {
  const existing = await getUserLibraryDocument(id);
  if (!existing) return;
  await patchUserLibraryDocument(id, { folderId });
}

/** Records an open without touching `updatedAt` (which means "content changed"). */
export async function markUserLibraryDocumentOpened(id: string): Promise<void> {
  const existing = await getUserLibraryDocument(id);
  if (!existing) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
      transaction.objectStore(DOCUMENTS_STORE).put({
        ...existing,
        lastOpenedAt: new Date().toISOString(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось обновить документ.'));
    });
    emitLibraryChanged();
  } finally {
    database.close();
  }
}

export async function removeUserLibraryDocument(id: string): Promise<void> {
  if (!id) return;
  const database = await openDatabase();
  try {
    const pages = await listUserLibraryPages(id);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [DOCUMENTS_STORE, FILES_STORE, PAGES_STORE],
        'readwrite',
      );
      transaction.objectStore(DOCUMENTS_STORE).delete(id);
      transaction.objectStore(FILES_STORE).delete(id);
      for (const page of pages) {
        transaction.objectStore(PAGES_STORE).delete(pageKey(page.documentId, page.pageIndex));
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить личный документ.'));
    });
    const { removeUserHighlightsForDocuments } = await import('@/state/user-library-highlights');
    await removeUserHighlightsForDocuments([id]);
    emitLibraryChanged();
  } finally {
    database.close();
  }
}

export async function putUserLibraryPage(page: UserLibraryPage): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PAGES_STORE, 'readwrite');
      transaction.objectStore(PAGES_STORE).put(page, pageKey(page.documentId, page.pageIndex));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить страницу.'));
    });
    emitLibraryChanged();
  } finally {
    database.close();
  }
}

export async function patchUserLibraryDocument(
  id: string,
  patch: Partial<
    Pick<
      UserLibraryDocument,
      | 'title'
      | 'pageCount'
      | 'nativeTextPages'
      | 'ocrDonePages'
      | 'ocrNeededPages'
      | 'status'
      | 'folderId'
      | 'hasImages'
      | 'ocrPriority'
      | 'ocrQuality'
      | 'errorMessage'
    >
  >,
): Promise<UserLibraryDocument | null> {
  const database = await openDatabase();
  try {
    const existing = await getUserLibraryDocument(id);
    if (!existing) return null;
    const updated: UserLibraryDocument = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
      transaction.objectStore(DOCUMENTS_STORE).put(updated);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось обновить документ.'));
    });
    emitLibraryChanged();
    return updated;
  } finally {
    database.close();
  }
}

function buildJpegPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  // Page geometry is in PDF points (1/72"), image pixels are CSS pixels (96/").
  const ptPerPx = 72 / 96;
  const pageWidth = Math.round(width * ptPerPx * 100) / 100;
  const pageHeight = Math.round(height * ptPerPx * 100) / 100;
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let byteLength = 0;
  const encoder = new TextEncoder();
  const appendText = (text: string): void => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  const appendBytes = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  const beginObject = (number: number): void => {
    offsets[number] = byteLength;
    appendText(`${number} 0 obj\n`);
  };

  appendText('%PDF-1.4\n');
  appendBytes(Uint8Array.from([37, 255, 255, 255, 255]));
  appendText('\n');
  beginObject(1);
  appendText('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObject(2);
  appendText('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  beginObject(3);
  appendText(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );
  beginObject(4);
  appendText(
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  appendBytes(jpeg);
  appendText('\nendstream\nendobj\n');
  const content = encoder.encode(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`);
  beginObject(5);
  appendText(`<< /Length ${content.length} >>\nstream\n`);
  appendBytes(content);
  appendText('endstream\nendobj\n');

  const xrefOffset = byteLength;
  appendText('xref\n0 6\n0000000000 65535 f \n');
  for (let number = 1; number <= 5; number += 1) {
    appendText(`${String(offsets[number] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  appendText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function imageToPdfFile(imageBlob: Blob, fileName: string): Promise<File> {
  if (typeof document === 'undefined') {
    throw new Error('Конвертация изображения доступна только в браузере.');
  }
  const url = URL.createObjectURL(imageBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
      element.src = url;
    });
    const maxDimension = 4096;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить PDF-копию изображения.');
    context.drawImage(image, 0, 0, width, height);
    const encoded = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    if (!encoded) throw new Error('Не удалось закодировать PDF-копию изображения.');
    const jpeg = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const pdfBytes = buildJpegPdf(jpeg, width, height);
    return new File([pdfBytes.buffer as ArrayBuffer], fileName, { type: 'application/pdf' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function requestUserLibraryOcr(
  id: string,
  quality: UserLibraryOcrQuality = 'balanced',
): Promise<'queued' | 'pdf-copy'> {
  const document = await getUserLibraryDocument(id);
  if (!document) return 'queued';
  if (isUserLibraryImageMime(document.mimeType)) {
    const image = await getUserLibraryFile(document.id);
    if (!image) throw new Error('Файл изображения недоступен.');
    const baseName = document.fileName.replace(/\.[^.]+$/u, '').trim() || document.fileName;
    const pdfFile = await imageToPdfFile(image, `${baseName} — OCR.pdf`);
    const copy = await addUserLibraryFile(pdfFile, document.folderId ?? null);
    await requestUserLibraryOcr(copy.id, quality);
    return 'pdf-copy';
  }
  const priority = Date.now();
  if (document.status === 'inspecting') {
    await patchUserLibraryDocument(id, { ocrPriority: priority, ocrQuality: quality });
    return 'queued';
  }
  const pages = await listUserLibraryPages(id);
  if (document.status !== 'ocr') {
    for (const page of pages) {
      await putUserLibraryPage({
        documentId: page.documentId,
        pageIndex: page.pageIndex,
        kind: 'pending',
        text: page.text,
      });
    }
    await patchUserLibraryDocument(id, {
      status: 'ocr',
      ocrPriority: priority,
      ocrQuality: quality,
      ocrNeededPages: Math.max(document.pageCount, pages.length),
      ocrDonePages: 0,
      nativeTextPages: 0,
      errorMessage: '',
    });
  } else {
    await patchUserLibraryDocument(id, { ocrPriority: priority, ocrQuality: quality });
  }
  void import('@/state/user-library-ingest').then(({ ensureUserLibraryIngestRunning }) => {
    ensureUserLibraryIngestRunning();
  });
  return 'queued';
}

export async function findNextPendingOcrPage(): Promise<{
  readonly documentId: string;
  readonly pageIndex: number;
} | null> {
  const documents = await listUserLibraryDocuments();
  const ocrDocuments = documents
    .filter((document) => document.status === 'ocr')
    .toSorted((left, right) => {
      const priority = (right.ocrPriority ?? 0) - (left.ocrPriority ?? 0);
      if (priority !== 0) return priority;
      return left.createdAt.localeCompare(right.createdAt);
    });
  for (const document of ocrDocuments) {
    const pages = await listUserLibraryPages(document.id);
    const pending = pages.find((page) => page.kind === 'pending');
    if (pending) return { documentId: pending.documentId, pageIndex: pending.pageIndex };
  }
  return null;
}

export async function addUserLibraryFile(
  file: File,
  folderId: string | null = null,
): Promise<UserLibraryDocument> {
  if (!('indexedDB' in globalThis) || !indexedDB) {
    throw new Error('Хранилище личных документов недоступно.');
  }
  const mimeType = validateFile(file);
  await validateUserLibraryFile(file.name, mimeType, await file.arrayBuffer());
  const now = new Date().toISOString();
  const title = file.name.replace(/\.[^.]+$/u, '').trim() || file.name;
  const document: UserLibraryDocument = {
    id: createDocumentId(),
    title,
    fileName: file.name,
    mimeType,
    byteLength: file.size,
    pageCount: 0,
    nativeTextPages: 0,
    ocrDonePages: 0,
    ocrNeededPages: 0,
    status: 'inspecting',
    folderId,
    hasImages: isUserLibraryVisualMime(mimeType),
    ocrQuality: 'balanced',
    createdAt: now,
    updatedAt: now,
  };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([DOCUMENTS_STORE, FILES_STORE], 'readwrite');
      transaction.objectStore(DOCUMENTS_STORE).put(document);
      transaction.objectStore(FILES_STORE).put(file, document.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить личный документ.'));
    });
  } finally {
    database.close();
  }
  emitLibraryChanged();
  void import('@/state/user-library-ingest')
    .then(({ processNewDocument }) => processNewDocument(document.id))
    .catch(async (cause) => {
      const message =
        cause instanceof Error ? cause.message : 'Не удалось обработать личный документ.';
      await patchUserLibraryDocument(document.id, { status: 'failed', errorMessage: message });
    });
  return document;
}

export async function searchUserLibrary(
  query: string,
  limit = 8,
): Promise<readonly UserLibraryMatch[]> {
  const queryStems = personalQueryStems(query);
  if (queryStems.length === 0) return [];
  const documents = await listUserLibraryDocuments();
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const database = await openDatabase();
  try {
    const pages = await readAllPages(database);
    const matches: UserLibraryMatch[] = [];

    const scoreOf = (text: string): number => personalMatchScore(queryStems, text);

    for (const document of documents) {
      const titleScore = scoreOf(`${document.title} ${document.fileName}`);
      if (titleScore > 0) {
        matches.push({
          document,
          pageIndex: 0,
          score: titleScore,
          snippet: snippetFor(document.title, queryStems),
        });
      }
    }

    for (const page of pages) {
      if (!page.text.trim()) continue;
      const document = documentsById.get(page.documentId);
      if (!document) continue;
      const score = scoreOf(page.text);
      if (score > 0) {
        matches.push({
          document,
          pageIndex: page.pageIndex,
          score,
          snippet: snippetFor(page.text, queryStems),
        });
      }
    }

    return matches
      .toSorted((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return right.document.updatedAt.localeCompare(left.document.updatedAt);
      })
      .slice(0, limit);
  } finally {
    database.close();
  }
}

export async function userLibrarySearchableCount(): Promise<number> {
  const documents = await listUserLibraryDocuments();
  let searchable = 0;
  for (const document of documents) {
    const pages = await listUserLibraryPages(document.id);
    if (pages.some((page) => page.text.trim().length > 0)) searchable += 1;
  }
  return searchable;
}

export function userLibraryProgressFraction(document: UserLibraryDocument): number {
  if (document.pageCount <= 0) return 0;
  return (document.nativeTextPages + document.ocrDonePages) / document.pageCount;
}
