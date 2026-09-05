export const USER_HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Жёлтый', fill: '#ffd54f' },
  { id: 'blue', label: 'Синий', fill: '#64b5f6' },
  { id: 'green', label: 'Зелёный', fill: '#81c784' },
  { id: 'pink', label: 'Розовый', fill: '#f48fb1' },
  { id: 'red', label: 'Красный', fill: '#ef5350' },
] as const;

export type UserHighlightColor = (typeof USER_HIGHLIGHT_COLORS)[number]['id'];

export function userHighlightColor(value: unknown): (typeof USER_HIGHLIGHT_COLORS)[number] {
  return USER_HIGHLIGHT_COLORS.find((color) => color.id === value) ?? USER_HIGHLIGHT_COLORS[0];
}

export interface UserDocumentHighlight {
  readonly id: string;
  readonly documentId: string;
  /** Text-section anchor, or the owning EPUB CFI for EPUB selections. */
  readonly pageAnchor: string;
  /** Character offsets within that page's plain text. */
  readonly start: number;
  readonly end: number;
  /** Quoted text for verification after re-extraction. */
  readonly quote: string;
  readonly cfiRange?: string;
  readonly color?: UserHighlightColor;
  readonly createdAt: string;
}

export const USER_HIGHLIGHTS_EVENT = 'minimed:user-highlights-changed';

const DATABASE_NAME = 'minimed-user-highlights-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'highlights';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('documentId', 'documentId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть хранилище выделений.'));
  });
}

export async function addUserHighlight(input: {
  readonly documentId: string;
  readonly pageAnchor: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly cfiRange?: string;
  readonly color?: UserHighlightColor;
}): Promise<UserDocumentHighlight> {
  const record: UserDocumentHighlight = {
    id: `hl-${crypto.randomUUID()}`,
    documentId: input.documentId,
    pageAnchor: input.pageAnchor,
    start: input.start,
    end: input.end,
    quote: input.quote,
    color: userHighlightColor(input.color).id,
    ...(input.cfiRange ? { cfiRange: input.cfiRange } : {}),
    createdAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось сохранить выделение.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(USER_HIGHLIGHTS_EVENT));
  return record;
}

export async function removeUserHighlight(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить выделение.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(USER_HIGHLIGHTS_EVENT));
}

export async function loadUserHighlights(
  documentId: string,
): Promise<readonly UserDocumentHighlight[]> {
  if (!('indexedDB' in globalThis) || !indexedDB) return [];
  const database = await openDatabase();
  try {
    const records = await new Promise<UserDocumentHighlight[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).index('documentId').getAll(documentId);
      request.onsuccess = () => resolve(request.result as UserDocumentHighlight[]);
      request.onerror = () => reject(request.error ?? new Error('Не удалось загрузить выделения.'));
    });
    return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } finally {
    database.close();
  }
}

export async function removeUserHighlightsForDocuments(
  documentIds: readonly string[],
): Promise<void> {
  if (documentIds.length === 0) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const index = transaction.objectStore(STORE_NAME).index('documentId');
      const request = index.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (documentIds.includes(cursor.value.documentId)) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось удалить выделения.'));
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(USER_HIGHLIGHTS_EVENT));
}
