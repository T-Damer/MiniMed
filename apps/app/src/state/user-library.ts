import { lightStemRussian, tokenize } from '@localmed/search-lexical';

export type UserLibraryOcrStatus = 'inspecting' | 'ready' | 'ocr' | 'failed';

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
  readonly errorMessage?: string;
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
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_SNIPPET_LENGTH = 180;

const PDF_MIME_TYPES = new Set(['application/pdf']);

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
]);

const TEXT_LIKE_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/rtf',
  'application/rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
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

function stems(value: string): readonly string[] {
  return tokenize(value).map(lightStemRussian);
}

function snippetFor(text: string, queryStems: readonly string[]): string {
  const words = text.split(/\s+/u);
  const hitIndex = words.findIndex((word) => {
    const stem = lightStemRussian(tokenize(word)[0] ?? '');
    return stem.length > 0 && queryStems.includes(stem);
  });
  if (hitIndex < 0) {
    return text.length <= MAX_SNIPPET_LENGTH ? text : `${text.slice(0, MAX_SNIPPET_LENGTH - 1)}…`;
  }
  const start = Math.max(0, hitIndex - 6);
  const snippet = words.slice(start, start + 18).join(' ');
  const prefix = start > 0 ? '…' : '';
  const suffix = start + 18 < words.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
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
    (candidate.status === 'inspecting' ||
      candidate.status === 'ready' ||
      candidate.status === 'ocr' ||
      candidate.status === 'failed')
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
  if (file.type && ALLOWED_MIME_TYPES.has(file.type)) return file.type;
  const extension = extensionOf(file.name);
  const mapped = EXTENSION_MIME_MAP[extension];
  if (mapped) return mapped;
  if (extension === 'xml' && (file.type === 'text/xml' || file.type === 'application/xml')) {
    return 'application/x-fictionbook+xml';
  }
  return file.type;
}

function validateFile(file: File): string {
  const mimeType = normalizeMimeType(file);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('Поддерживаются PDF, текст, Office, книги (EPUB/FB2) и изображения.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Размер файла не должен превышать 40 МБ.');
  }
  return mimeType;
}

function emitLibraryChanged(): void {
  window.dispatchEvent(new CustomEvent(USER_LIBRARY_EVENT));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
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
    request.onsuccess = () => {
      resolve(request.result.filter(isDocument));
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось прочитать личные документы.'));
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

export async function findNextPendingOcrPage(): Promise<{
  readonly documentId: string;
  readonly pageIndex: number;
} | null> {
  const documents = await listUserLibraryDocuments();
  const ocrDocuments = documents
    .filter((document) => document.status === 'ocr')
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const document of ocrDocuments) {
    const pages = await listUserLibraryPages(document.id);
    const pending = pages.find((page) => page.kind === 'pending');
    if (pending) {
      return { documentId: pending.documentId, pageIndex: pending.pageIndex };
    }
  }
  return null;
}

export async function addUserLibraryFile(file: File): Promise<UserLibraryDocument> {
  if (!('indexedDB' in globalThis) || !indexedDB) {
    throw new Error('Хранилище личных документов недоступно.');
  }
  const mimeType = validateFile(file);
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
  const queryStems = [...new Set(stems(query))];
  if (queryStems.length === 0) return [];
  const documents = await listUserLibraryDocuments();
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const database = await openDatabase();
  try {
    const pages = await readAllPages(database);
    const matches: UserLibraryMatch[] = [];

    const scoreOf = (text: string): number => {
      const textStems = new Set(stems(text));
      return queryStems.filter((stem) => textStems.has(stem)).length;
    };

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
    if (pages.some((page) => page.text.trim().length > 0)) {
      searchable += 1;
    }
  }
  return searchable;
}

export function userLibraryProgressFraction(document: UserLibraryDocument): number {
  if (document.pageCount <= 0) return 0;
  return (document.nativeTextPages + document.ocrDonePages) / document.pageCount;
}
