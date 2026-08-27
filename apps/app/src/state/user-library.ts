import exampleCtUrl from '@/assets/example-ct.dcm?url';
import exampleMriUrl from '@/assets/example-mri.nii?url';
import {
  personalMatchScore,
  personalQueryStems,
  wordMatchesQueryStem,
} from '@/state/personal-stem-match';
import {
  createEditableUserLibraryFile,
  isEditableUserLibraryFile,
  validateUserLibraryFile,
} from '@/state/user-library-formats';

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
  readonly source?: UserLibraryDocumentSource;
  readonly hasImages?: boolean;
  readonly ocrPriority?: number;
  readonly ocrQuality?: UserLibraryOcrQuality;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt?: string;
}

export type UserLibraryDocumentSource =
  | { readonly kind: 'note'; readonly noteId: string }
  | {
      readonly kind: 'note-attachment';
      readonly noteId: string;
      readonly attachmentId: string;
    };

export interface UserLibraryFolder {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isSystem?: boolean;
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

export type UserLibraryMedicalAnnotationColor = 'red' | 'blue';

export interface UserLibraryMedicalAnnotationPoint {
  readonly x: number;
  readonly y: number;
}

export interface UserLibraryMedicalAnnotationStroke {
  readonly id: string;
  readonly color: UserLibraryMedicalAnnotationColor;
  readonly points: readonly UserLibraryMedicalAnnotationPoint[];
}

interface UserLibraryMedicalAnnotationRecord {
  readonly documentId: string;
  readonly slices: Readonly<Record<string, readonly UserLibraryMedicalAnnotationStroke[]>>;
  readonly volumeBitmap?: Uint8Array;
  readonly updatedAt: string;
}

export interface UserLibraryMatch {
  readonly document: UserLibraryDocument;
  readonly pageIndex: number;
  readonly score: number;
  readonly snippet: string;
}

export const USER_LIBRARY_EVENT = 'minimed:user-library-changed';
export const USER_LIBRARY_NOTES_FOLDER_ID = 'user-folder-notes';
export const USER_LIBRARY_NOTES_FOLDER_TITLE = 'Заметки';
export const USER_LIBRARY_EXAMPLE_CT_FILE_NAME = 'Пример КТ.dcm';
export const USER_LIBRARY_EXAMPLE_MRI_FILE_NAME = 'Пример МРТ.nii';

const DATABASE_NAME = 'minimed-user-library-v1';
const DOCUMENTS_STORE = 'documents';
const FILES_STORE = 'files';
const PAGES_STORE = 'pages';
const FOLDERS_STORE = 'folders';
const MEDICAL_ANNOTATIONS_STORE = 'medical-annotations';
const DATABASE_VERSION = 3;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_SNIPPET_LENGTH = 180;
const LEGACY_EXAMPLE_CT_SEEDED_KEY = 'minimed.userLibrary.exampleCtSeeded.v1';
const LEGACY_MEDICAL_EXAMPLES_SEEDED_KEY = 'minimed.userLibrary.medicalExamplesSeeded.v2';
const LEGACY_REAL_MEDICAL_EXAMPLES_SEEDED_KEY = 'minimed.userLibrary.medicalExamplesSeeded.v3';
const LEGACY_CURRENT_MEDICAL_EXAMPLES_SEEDED_KEY = 'minimed.userLibrary.medicalExamplesSeeded.v4';
const MEDICAL_EXAMPLES_SEEDED_KEY = 'minimed.userLibrary.medicalExamplesSeeded.v5';

export const USER_LIBRARY_NAME_MAX_LENGTH = 256;

const PDF_MIME_TYPES = new Set(['application/pdf']);

const DICOM_MIME_TYPES = new Set(['application/dicom']);

const MEDICAL_VOLUME_MIME_TYPES = new Set([
  'application/x-afni',
  'application/x-analyze',
  'application/x-metaimage',
  'application/x-mgh',
  'application/x-mrtrix',
  'application/x-nifti',
  'application/x-nrrd',
  'application/x-numpy',
]);

const MEDICAL_VOLUME_EXTENSIONS = new Set([
  'brik',
  'head',
  'hdr',
  'img',
  'mha',
  'mhd',
  'mgh',
  'mgz',
  'mif',
  'mih',
  'nhdr',
  'nii',
  'nii.gz',
  'npy',
  'npz',
  'nrrd',
]);

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
  ...DICOM_MIME_TYPES,
  ...MEDICAL_VOLUME_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
  ...TEXT_LIKE_MIME_TYPES,
]);

const EXTENSION_MIME_MAP: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  dcm: 'application/dicom',
  dicom: 'application/dicom',
  nii: 'application/x-nifti',
  nrrd: 'application/x-nrrd',
  nhdr: 'application/x-nrrd',
  mif: 'application/x-mrtrix',
  mih: 'application/x-mrtrix',
  mgh: 'application/x-mgh',
  mgz: 'application/x-mgh',
  mha: 'application/x-metaimage',
  mhd: 'application/x-metaimage',
  head: 'application/x-afni',
  brik: 'application/x-afni',
  hdr: 'application/x-analyze',
  img: 'application/x-analyze',
  npy: 'application/x-numpy',
  npz: 'application/x-numpy',
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

export function isUserLibraryDicomMime(mime: string): boolean {
  return DICOM_MIME_TYPES.has(mime);
}

export function isUserLibraryDicomFile(mime: string, fileName: string): boolean {
  const extension = extensionOf(fileName);
  return isUserLibraryDicomMime(mime) || extension === 'dcm' || extension === 'dicom';
}

function medicalVolumeExtension(fileName: string): string {
  const lower = fileName.toLocaleLowerCase('ru-RU');
  return lower.endsWith('.nii.gz') ? 'nii.gz' : extensionOf(lower);
}

export function isUserLibraryVolumeFile(mime: string, fileName: string): boolean {
  return (
    MEDICAL_VOLUME_MIME_TYPES.has(mime) ||
    MEDICAL_VOLUME_EXTENSIONS.has(medicalVolumeExtension(fileName))
  );
}

export function isUserLibraryMedicalImageFile(mime: string, fileName: string): boolean {
  return isUserLibraryDicomFile(mime, fileName) || isUserLibraryVolumeFile(mime, fileName);
}

export function isUserLibraryImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime);
}

export function isUserLibraryVisualMime(mime: string): boolean {
  return (
    isUserLibraryPdfMime(mime) ||
    isUserLibraryImageMime(mime) ||
    MEDICAL_VOLUME_MIME_TYPES.has(mime)
  );
}

export function isUserLibraryTextLikeMime(mime: string): boolean {
  return TEXT_LIKE_MIME_TYPES.has(mime);
}

export function userLibraryFileAccept(): string {
  const extensions = Object.keys(EXTENSION_MIME_MAP)
    .map((ext) => `.${ext}`)
    .join(',');
  const mimeTypes = [...ALLOWED_MIME_TYPES].join(',');
  return `.nii.gz,${extensions},${mimeTypes}`;
}

export type UserLibraryFileKind =
  | 'pdf'
  | 'dicom'
  | 'volume'
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
  dcm: 'dicom',
  dicom: 'dicom',
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
  tar: 'archive',
  tgz: 'archive',
  gz: 'archive',
  bz2: 'archive',
  xz: 'archive',
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
  if (isUserLibraryDicomFile(mime, fileName)) return 'dicom';
  if (isUserLibraryVolumeFile(mime, fileName)) return 'volume';
  const byExtension = FILE_KIND_BY_EXTENSION[extensionOf(fileName)];
  if (byExtension) return byExtension;
  if (isUserLibraryPdfMime(mime)) return 'pdf';
  if (isUserLibraryImageMime(mime)) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/')) return 'text';
  return 'binary';
}

export function isUserLibraryArchive(fileName: string): boolean {
  const lower = fileName.toLocaleLowerCase('ru-RU');
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.rar') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.bz2') ||
    lower.endsWith('.tbz2') ||
    lower.endsWith('.tar.xz') ||
    lower.endsWith('.txz')
  );
}

export function normalizeUserLibraryName(value: string, kind: 'file' | 'folder'): string {
  const trimmed = value.trim();
  if (!trimmed)
    throw new Error(kind === 'folder' ? 'Введите название папки.' : 'Имя файла пустое.');
  if ([...trimmed].length > USER_LIBRARY_NAME_MAX_LENGTH) {
    throw new Error(
      `${kind === 'folder' ? 'Название папки' : 'Имя файла'} не должно быть длиннее ${USER_LIBRARY_NAME_MAX_LENGTH} символов.`,
    );
  }
  if (trimmed.includes('\u0000') || /[\\/]/u.test(trimmed)) {
    throw new Error(
      `${kind === 'folder' ? 'Название папки' : 'Имя файла'} содержит недопустимый символ.`,
    );
  }
  return trimmed;
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
    (candidate.source === undefined || isDocumentSource(candidate.source)) &&
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

function isDocumentSource(value: unknown): value is UserLibraryDocumentSource {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserLibraryDocumentSource>;
  if (candidate.kind === 'note') {
    return typeof candidate.noteId === 'string' && !('attachmentId' in candidate);
  }
  return (
    candidate.kind === 'note-attachment' &&
    typeof candidate.noteId === 'string' &&
    typeof candidate.attachmentId === 'string'
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
    typeof candidate.updatedAt === 'string' &&
    (candidate.isSystem === undefined || typeof candidate.isSystem === 'boolean')
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

function isMedicalAnnotationPoint(value: unknown): value is UserLibraryMedicalAnnotationPoint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserLibraryMedicalAnnotationPoint>;
  return (
    typeof candidate.x === 'number' &&
    Number.isFinite(candidate.x) &&
    candidate.x >= 0 &&
    candidate.x <= 1 &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.y) &&
    candidate.y >= 0 &&
    candidate.y <= 1
  );
}

function isMedicalAnnotationStroke(value: unknown): value is UserLibraryMedicalAnnotationStroke {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserLibraryMedicalAnnotationStroke>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    candidate.id.length <= 128 &&
    (candidate.color === 'red' || candidate.color === 'blue') &&
    Array.isArray(candidate.points) &&
    candidate.points.length > 0 &&
    candidate.points.length <= 4096 &&
    candidate.points.every(isMedicalAnnotationPoint)
  );
}

function isMedicalAnnotationRecord(value: unknown): value is UserLibraryMedicalAnnotationRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserLibraryMedicalAnnotationRecord>;
  if (
    typeof candidate.documentId !== 'string' ||
    typeof candidate.updatedAt !== 'string' ||
    !candidate.slices ||
    typeof candidate.slices !== 'object'
  ) {
    return false;
  }
  if (
    candidate.volumeBitmap !== undefined &&
    (!(candidate.volumeBitmap instanceof Uint8Array) ||
      candidate.volumeBitmap.byteLength > MAX_FILE_BYTES)
  ) {
    return false;
  }
  const slices = Object.entries(candidate.slices);
  return (
    slices.length <= 4096 &&
    slices.every(
      ([sliceKey, strokes]) =>
        sliceKey.length > 0 &&
        sliceKey.length <= 128 &&
        Array.isArray(strokes) &&
        strokes.length <= 512 &&
        strokes.every(isMedicalAnnotationStroke),
    )
  );
}

function extensionOf(fileName: string): string {
  const lower = fileName.toLocaleLowerCase('ru-RU');
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot + 1) : '';
}

function normalizeMimeType(file: File): string {
  if (file.name.toLocaleLowerCase('ru-RU').endsWith('.nii.gz')) return 'application/x-nifti';
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
  normalizeUserLibraryName(file.name, 'file');
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
      if (!database.objectStoreNames.contains(MEDICAL_ANNOTATIONS_STORE)) {
        database.createObjectStore(MEDICAL_ANNOTATIONS_STORE, { keyPath: 'documentId' });
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

async function ensureUserLibraryNotesFolder(database: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FOLDERS_STORE, 'readwrite');
    const store = transaction.objectStore(FOLDERS_STORE);
    const request = store.get(USER_LIBRARY_NOTES_FOLDER_ID) as IDBRequest<
      UserLibraryFolder | undefined
    >;
    request.onsuccess = () => {
      const existing = request.result;
      if (
        existing &&
        isFolder(existing) &&
        existing.title === USER_LIBRARY_NOTES_FOLDER_TITLE &&
        existing.parentId === null &&
        existing.isSystem === true
      ) {
        return;
      }
      const now = new Date().toISOString();
      store.put({
        id: USER_LIBRARY_NOTES_FOLDER_ID,
        title: USER_LIBRARY_NOTES_FOLDER_TITLE,
        parentId: null,
        createdAt: isFolder(existing) ? existing.createdAt : now,
        updatedAt: now,
        isSystem: true,
      } satisfies UserLibraryFolder);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось подготовить папку заметок.'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Не удалось подготовить папку заметок.'));
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

export async function ensureUserLibraryMedicalExamples(): Promise<boolean> {
  let legacyCtSeeded = false;
  let legacyMedicalExamplesSeeded = false;
  let legacyRealMedicalExamplesSeeded = false;
  let legacyCurrentMedicalExamplesSeeded = false;
  try {
    if (localStorage.getItem(MEDICAL_EXAMPLES_SEEDED_KEY) === '1') return false;
    legacyCurrentMedicalExamplesSeeded =
      localStorage.getItem(LEGACY_CURRENT_MEDICAL_EXAMPLES_SEEDED_KEY) === '1';
    legacyRealMedicalExamplesSeeded =
      !legacyCurrentMedicalExamplesSeeded &&
      localStorage.getItem(LEGACY_REAL_MEDICAL_EXAMPLES_SEEDED_KEY) === '1';
    legacyMedicalExamplesSeeded =
      !legacyCurrentMedicalExamplesSeeded &&
      !legacyRealMedicalExamplesSeeded &&
      localStorage.getItem(LEGACY_MEDICAL_EXAMPLES_SEEDED_KEY) === '1';
    legacyCtSeeded =
      !legacyCurrentMedicalExamplesSeeded &&
      !legacyRealMedicalExamplesSeeded &&
      !legacyMedicalExamplesSeeded &&
      localStorage.getItem(LEGACY_EXAMPLE_CT_SEEDED_KEY) === '1';
  } catch {
    // IndexedDB and the filename check below still prevent duplicates without localStorage.
  }

  const existing = await listUserLibraryDocuments();
  let changed = false;
  const samples = [
    {
      fileName: USER_LIBRARY_EXAMPLE_CT_FILE_NAME,
      mimeType: 'application/dicom',
      url: exampleCtUrl,
      replaceExisting:
        legacyCtSeeded ||
        legacyMedicalExamplesSeeded ||
        legacyRealMedicalExamplesSeeded ||
        legacyCurrentMedicalExamplesSeeded,
    },
    {
      fileName: USER_LIBRARY_EXAMPLE_MRI_FILE_NAME,
      mimeType: 'application/x-nifti',
      url: exampleMriUrl,
      replaceExisting: legacyMedicalExamplesSeeded || legacyRealMedicalExamplesSeeded,
    },
  ] as const;
  for (const sample of samples) {
    const current = existing.find((document) => document.fileName === sample.fileName);
    if (current && !sample.replaceExisting) continue;
    const response = await fetch(sample.url);
    if (!response.ok) throw new Error(`Не удалось добавить «${sample.fileName}».`);
    const file = new File([await response.blob()], sample.fileName, { type: sample.mimeType });
    if (current) await replaceUserLibraryFile(current.id, file);
    else await addUserLibraryFile(file);
    changed = true;
  }

  try {
    localStorage.setItem(MEDICAL_EXAMPLES_SEEDED_KEY, '1');
  } catch {
    // The samples remain deduplicated by filename when localStorage is unavailable.
  }
  return changed;
}

export async function listUserLibraryFolders(): Promise<readonly UserLibraryFolder[]> {
  if (!('indexedDB' in globalThis) || !indexedDB) return [];
  const database = await openDatabase();
  try {
    await ensureUserLibraryNotesFolder(database);
    return (await readAllFolders(database)).toSorted((left, right) =>
      left.title.localeCompare(right.title, 'ru-RU'),
    );
  } finally {
    database.close();
  }
}

export function isUserLibrarySystemFolder(folder: Pick<UserLibraryFolder, 'isSystem'>): boolean {
  return folder.isSystem === true;
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

export async function getUserLibraryMedicalAnnotations(
  documentId: string,
  sliceKey: string,
): Promise<readonly UserLibraryMedicalAnnotationStroke[]> {
  if (!documentId || !sliceKey || !('indexedDB' in globalThis) || !indexedDB) return [];
  const database = await openDatabase();
  try {
    const record = await new Promise<UserLibraryMedicalAnnotationRecord | undefined>(
      (resolve, reject) => {
        const request = database
          .transaction(MEDICAL_ANNOTATIONS_STORE, 'readonly')
          .objectStore(MEDICAL_ANNOTATIONS_STORE)
          .get(documentId) as IDBRequest<UserLibraryMedicalAnnotationRecord | undefined>;
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('Не удалось прочитать разметку снимка.'));
      },
    );
    return record && isMedicalAnnotationRecord(record) ? (record.slices[sliceKey] ?? []) : [];
  } finally {
    database.close();
  }
}

export async function putUserLibraryMedicalAnnotations(
  documentId: string,
  sliceKey: string,
  strokes: readonly UserLibraryMedicalAnnotationStroke[],
): Promise<void> {
  if (!documentId || !sliceKey || sliceKey.length > 128) {
    throw new Error('Некорректный идентификатор разметки снимка.');
  }
  if (strokes.length > 512 || !strokes.every(isMedicalAnnotationStroke)) {
    throw new Error('Некорректная разметка снимка.');
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MEDICAL_ANNOTATIONS_STORE, 'readwrite');
      const store = transaction.objectStore(MEDICAL_ANNOTATIONS_STORE);
      const request = store.get(documentId) as IDBRequest<
        UserLibraryMedicalAnnotationRecord | undefined
      >;
      request.onsuccess = () => {
        const currentRecord = isMedicalAnnotationRecord(request.result) ? request.result : null;
        const current = currentRecord?.slices ?? {};
        const slices: Record<string, readonly UserLibraryMedicalAnnotationStroke[]> = {
          ...current,
        };
        if (strokes.length > 0) slices[sliceKey] = strokes;
        else delete slices[sliceKey];
        if (Object.keys(slices).length === 0 && !currentRecord?.volumeBitmap) {
          store.delete(documentId);
        } else {
          store.put({
            documentId,
            slices,
            ...(currentRecord?.volumeBitmap ? { volumeBitmap: currentRecord.volumeBitmap } : {}),
            updatedAt: new Date().toISOString(),
          } satisfies UserLibraryMedicalAnnotationRecord);
        }
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Не удалось подготовить разметку снимка.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить разметку снимка.'));
    });
  } finally {
    database.close();
  }
}

export async function getUserLibraryMedicalAnnotationBitmap(
  documentId: string,
): Promise<Uint8Array | null> {
  if (!documentId || !('indexedDB' in globalThis) || !indexedDB) return null;
  const database = await openDatabase();
  try {
    const record = await new Promise<UserLibraryMedicalAnnotationRecord | undefined>(
      (resolve, reject) => {
        const request = database
          .transaction(MEDICAL_ANNOTATIONS_STORE, 'readonly')
          .objectStore(MEDICAL_ANNOTATIONS_STORE)
          .get(documentId) as IDBRequest<UserLibraryMedicalAnnotationRecord | undefined>;
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('Не удалось прочитать разметку volume-снимка.'));
      },
    );
    return record && isMedicalAnnotationRecord(record) && record.volumeBitmap
      ? record.volumeBitmap.slice()
      : null;
  } finally {
    database.close();
  }
}

export async function putUserLibraryMedicalAnnotationBitmap(
  documentId: string,
  bitmap: Uint8Array,
): Promise<void> {
  if (!documentId || bitmap.byteLength > MAX_FILE_BYTES) {
    throw new Error('Некорректная разметка volume-снимка.');
  }
  const volumeBitmap = bitmap.some((value) => value !== 0) ? bitmap.slice() : undefined;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MEDICAL_ANNOTATIONS_STORE, 'readwrite');
      const store = transaction.objectStore(MEDICAL_ANNOTATIONS_STORE);
      const request = store.get(documentId) as IDBRequest<
        UserLibraryMedicalAnnotationRecord | undefined
      >;
      request.onsuccess = () => {
        const current = isMedicalAnnotationRecord(request.result) ? request.result : null;
        const slices = current?.slices ?? {};
        if (!volumeBitmap && Object.keys(slices).length === 0) store.delete(documentId);
        else {
          store.put({
            documentId,
            slices,
            ...(volumeBitmap ? { volumeBitmap } : {}),
            updatedAt: new Date().toISOString(),
          } satisfies UserLibraryMedicalAnnotationRecord);
        }
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Не удалось подготовить разметку volume-снимка.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить разметку volume-снимка.'));
    });
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
  const trimmed = normalizeUserLibraryName(title, 'folder');
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
  if (id === USER_LIBRARY_NOTES_FOLDER_ID) throw new Error('Папку «Заметки» нельзя переименовать.');
  const trimmed = normalizeUserLibraryName(title, 'folder');
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
  if (id === USER_LIBRARY_NOTES_FOLDER_ID) throw new Error('Папку «Заметки» нельзя переместить.');
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
  if (id === USER_LIBRARY_NOTES_FOLDER_ID) throw new Error('Папку «Заметки» нельзя удалить.');
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
  const trimmed = normalizeUserLibraryName(title, 'file');
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
        [DOCUMENTS_STORE, FILES_STORE, PAGES_STORE, MEDICAL_ANNOTATIONS_STORE],
        'readwrite',
      );
      transaction.objectStore(DOCUMENTS_STORE).delete(id);
      transaction.objectStore(FILES_STORE).delete(id);
      transaction.objectStore(MEDICAL_ANNOTATIONS_STORE).delete(id);
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

export interface UserLibraryPdfImage {
  readonly jpeg: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export function buildUserLibraryImagePdf(pages: readonly UserLibraryPdfImage[]): Uint8Array {
  if (pages.length === 0) throw new Error('Нужна хотя бы одна фотография.');
  const chunks: Uint8Array[] = [];
  const objectCount = 3 + pages.length * 3;
  const offsets = new Array<number>(objectCount).fill(0);
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
  const pageReferences = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
  appendText(`<< /Type /Pages /Kids [${pageReferences}] /Count ${pages.length} >>\nendobj\n`);
  pages.forEach((page, index) => {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const ptPerPx = 72 / 96;
    const naturalWidth = Math.round(page.width * ptPerPx * 100) / 100;
    const naturalHeight = Math.round(page.height * ptPerPx * 100) / 100;
    const mediaWidth = naturalWidth;
    const mediaHeight = naturalHeight;

    beginObject(pageObject);
    appendText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${mediaWidth} ${mediaHeight}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`,
    );
    beginObject(imageObject);
    appendText(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    appendBytes(page.jpeg);
    appendText('\nendstream\nendobj\n');
    const content = encoder.encode(`q\n${mediaWidth} 0 0 ${mediaHeight} 0 0 cm\n/Im0 Do\nQ\n`);
    beginObject(contentObject);
    appendText(`<< /Length ${content.length} >>\nstream\n`);
    appendBytes(content);
    appendText('endstream\nendobj\n');
  });

  const xrefOffset = byteLength;
  appendText(`xref\n0 ${objectCount}\n0000000000 65535 f \n`);
  for (let number = 1; number < objectCount; number += 1) {
    appendText(`${String(offsets[number] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  appendText(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function imageToJpegPage(imageBlob: Blob): Promise<UserLibraryPdfImage> {
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
    return { jpeg, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function imageToPdfFile(imageBlob: Blob, fileName: string): Promise<File> {
  const page = await imageToJpegPage(imageBlob);
  const pdfBytes = buildUserLibraryImagePdf([page]);
  return new File([pdfBytes.buffer as ArrayBuffer], fileName, { type: 'application/pdf' });
}

export async function createUserLibraryPdfFromImages(
  documents: readonly UserLibraryDocument[],
  fileName: string,
  folderId: string | null = null,
): Promise<UserLibraryDocument> {
  if (documents.length === 0) throw new Error('Нужна хотя бы одна фотография.');
  if (documents.some((document) => !isUserLibraryImageMime(document.mimeType))) {
    throw new Error('Для PDF можно выбрать только фотографии.');
  }
  const pages: UserLibraryPdfImage[] = [];
  for (const document of documents) {
    const image = await getUserLibraryFile(document.id);
    if (!image) throw new Error(`Файл «${document.fileName}» недоступен.`);
    pages.push(await imageToJpegPage(image));
  }
  const pdfBytes = buildUserLibraryImagePdf(pages);
  const pdfFile = new File([pdfBytes.buffer as ArrayBuffer], fileName, {
    type: 'application/pdf',
  });
  return addUserLibraryFile(pdfFile, folderId);
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
  source?: UserLibraryDocumentSource,
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
    ...(source ? { source } : {}),
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

export async function replaceUserLibraryFile(
  id: string,
  file: File,
  options: {
    readonly folderId?: string | null;
    readonly source?: UserLibraryDocumentSource;
  } = {},
): Promise<UserLibraryDocument | null> {
  const existing = await getUserLibraryDocument(id);
  if (!existing) return null;
  const mimeType = validateFile(file);
  await validateUserLibraryFile(file.name, mimeType, await file.arrayBuffer());
  const pages = await listUserLibraryPages(id);
  const now = new Date().toISOString();
  const title = file.name.replace(/\.[^.]+$/u, '').trim() || file.name;
  const updated: UserLibraryDocument = {
    ...existing,
    title,
    fileName: file.name,
    mimeType,
    byteLength: file.size,
    pageCount: 0,
    nativeTextPages: 0,
    ocrDonePages: 0,
    ocrNeededPages: 0,
    status: 'inspecting',
    ...(Object.hasOwn(options, 'folderId') ? { folderId: options.folderId } : {}),
    ...(options.source ? { source: options.source } : {}),
    hasImages: isUserLibraryVisualMime(mimeType),
    errorMessage: '',
    updatedAt: now,
  };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [DOCUMENTS_STORE, FILES_STORE, PAGES_STORE, MEDICAL_ANNOTATIONS_STORE],
        'readwrite',
      );
      transaction.objectStore(DOCUMENTS_STORE).put(updated);
      transaction.objectStore(FILES_STORE).put(file, id);
      transaction.objectStore(MEDICAL_ANNOTATIONS_STORE).delete(id);
      const pageStore = transaction.objectStore(PAGES_STORE);
      for (const page of pages) pageStore.delete(pageKey(page.documentId, page.pageIndex));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось обновить личный документ.'));
    });
  } finally {
    database.close();
  }
  emitLibraryChanged();
  void import('@/state/user-library-ingest')
    .then(({ processNewDocument }) => processNewDocument(id))
    .catch(async (cause) => {
      const message =
        cause instanceof Error ? cause.message : 'Не удалось обработать личный документ.';
      await patchUserLibraryDocument(id, { status: 'failed', errorMessage: message });
    });
  return updated;
}

export async function saveUserLibraryDraft(
  id: string,
  text: string,
): Promise<UserLibraryDocument | null> {
  const existing = await getUserLibraryDocument(id);
  if (!existing) return null;
  if (!isEditableUserLibraryFile(existing.fileName, existing.mimeType)) {
    throw new Error('Этот тип файла нельзя редактировать во встроенном редакторе.');
  }
  const file = createEditableUserLibraryFile(existing.fileName, existing.mimeType, text);
  const pages = await listUserLibraryPages(id);
  const updated: UserLibraryDocument = {
    ...existing,
    byteLength: file.size,
    pageCount: 0,
    nativeTextPages: 0,
    ocrDonePages: 0,
    ocrNeededPages: 0,
    status: 'inspecting',
    errorMessage: '',
    updatedAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [DOCUMENTS_STORE, FILES_STORE, PAGES_STORE],
        'readwrite',
      );
      transaction.objectStore(DOCUMENTS_STORE).put(updated);
      transaction.objectStore(FILES_STORE).put(file, id);
      const pageStore = transaction.objectStore(PAGES_STORE);
      for (const page of pages) pageStore.delete(pageKey(page.documentId, page.pageIndex));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить черновик документа.'));
    });
  } finally {
    database.close();
  }
  emitLibraryChanged();
  try {
    const { processNewDocument } = await import('@/state/user-library-ingest');
    await processNewDocument(id);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : 'Не удалось обработать сохранённый черновик.';
    await patchUserLibraryDocument(id, { status: 'failed', errorMessage: message });
    throw cause;
  }
  if (existing.source?.kind === 'note') {
    const { updatePatientNote } = await import('@/state/patient-notes');
    updatePatientNote(existing.source.noteId, text);
  }
  return await getUserLibraryDocument(id);
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
