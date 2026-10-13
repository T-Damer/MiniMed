import type { AnchorMethod, TextQuoteSelector } from '@/features/anchoring/text-anchor';

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

/**
 * How a highlight sits in the document being read.
 * `exact` — the text is where it was selected; `moved` — the same words, found elsewhere in a newer
 * edition; `approximate` — reworded text carried over by similarity; `missing` — the newer edition
 * has no such text: the highlight is kept (and listed), not painted.
 */
export type HighlightAnchorStatus = 'exact' | 'moved' | 'approximate' | 'missing';

/** One piece of text a highlight covers: a unit of the document and character offsets in it. */
export interface HighlightSegment {
  readonly pageAnchor: string;
  readonly start: number;
  readonly end: number;
}

/** Where a highlight was first selected; never rewritten by re-anchoring. */
export interface HighlightOrigin extends HighlightSegment {
  readonly documentId: string;
  readonly at: string;
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
  /** Position-independent anchor (W3C text-quote selector): what edition changes re-anchor by. */
  readonly selector?: TextQuoteSelector;
  /** Absent on records saved before anchors existed: they are `exact`. */
  readonly anchorStatus?: HighlightAnchorStatus;
  readonly anchorMethod?: AnchorMethod;
  /** 0..1 confidence of the last re-anchoring. */
  readonly anchorScore?: number;
  /** Further pieces when the text now spans several units (a reflowed paragraph). */
  readonly more?: readonly HighlightSegment[];
  /** Fingerprint of the document content the anchor was last settled against. */
  readonly anchoredRevision?: string;
  readonly origin?: HighlightOrigin;
  /** Set on a copy made in a newer edition: the highlight it came from stays on the old edition. */
  readonly carriedFrom?: {
    readonly documentId: string;
    readonly highlightId: string;
    /** The first highlight of the chain, so a copy is made once per edition. */
    readonly rootId: string;
  };
  /** A carried copy the reader removed: kept as a tombstone so it is not carried again. */
  readonly dismissed?: boolean;
}

export const USER_HIGHLIGHTS_EVENT = 'minimed:user-highlights-changed';

const DATABASE_NAME = 'minimed-user-highlights-v1';
/** 2: every record carries a text-quote selector and an anchor status (see `upgradeHighlight`). */
const DATABASE_VERSION = 2;
const STORE_NAME = 'highlights';

/**
 * Brings a stored record to the current shape: a quote selector built from the saved quote (the
 * surrounding context is filled in when the document is next opened), an `exact` status and the
 * origin of the anchor. Idempotent; records that are current come back as they are.
 */
export function upgradeHighlight(record: UserDocumentHighlight): UserDocumentHighlight {
  if (record.cfiRange) return record;
  const selector = record.selector ?? { exact: record.quote, prefix: '', suffix: '' };
  const origin = record.origin ?? {
    documentId: record.documentId,
    pageAnchor: record.pageAnchor,
    start: record.start,
    end: record.end,
    at: record.createdAt,
  };
  if (record.selector && record.anchorStatus && record.origin) return record;
  return {
    ...record,
    selector,
    anchorStatus: record.anchorStatus ?? 'exact',
    origin,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('documentId', 'documentId', { unique: false });
      }
      if (event.oldVersion >= 1 && event.oldVersion < 2 && transaction) {
        const store = transaction.objectStore(STORE_NAME);
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          cursor.update(upgradeHighlight(cursor.value as UserDocumentHighlight));
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть хранилище выделений.'));
  });
}

function runWrite(
  database: IDBDatabase,
  write: (store: IDBObjectStore) => void,
  failure: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    write(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(failure));
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
  readonly selector?: TextQuoteSelector;
}): Promise<UserDocumentHighlight> {
  const createdAt = new Date().toISOString();
  const base: UserDocumentHighlight = {
    id: `hl-${crypto.randomUUID()}`,
    documentId: input.documentId,
    pageAnchor: input.pageAnchor,
    start: input.start,
    end: input.end,
    quote: input.quote,
    color: userHighlightColor(input.color).id,
    ...(input.cfiRange ? { cfiRange: input.cfiRange } : {}),
    ...(input.selector ? { selector: input.selector } : {}),
    createdAt,
  };
  const record = upgradeHighlight(base);
  const database = await openDatabase();
  try {
    await runWrite(database, (store) => store.put(record), 'Не удалось сохранить выделение.');
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(USER_HIGHLIGHTS_EVENT));
  return record;
}

/** Writes changed records in one transaction and announces the change once. */
export async function putUserHighlights(records: readonly UserDocumentHighlight[]): Promise<void> {
  if (records.length === 0) return;
  const database = await openDatabase();
  try {
    await runWrite(
      database,
      (store) => {
        for (const record of records) store.put(record);
      },
      'Не удалось сохранить выделения.',
    );
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(USER_HIGHLIGHTS_EVENT));
}

async function readOne(database: IDBDatabase, id: string): Promise<UserDocumentHighlight | null> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () =>
      resolve((request.result as UserDocumentHighlight | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Не удалось загрузить выделение.'));
  });
}

/**
 * Removes a highlight. A copy carried into a newer edition is kept as a tombstone instead, so the
 * next opening does not carry the old highlight over again.
 */
export async function removeUserHighlight(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const existing = await readOne(database, id);
    await runWrite(
      database,
      (store) => {
        if (existing?.carriedFrom) store.put({ ...existing, dismissed: true });
        else store.delete(id);
      },
      'Не удалось удалить выделение.',
    );
  } finally {
    database.close();
  }
  window.dispatchEvent(new Event(USER_HIGHLIGHTS_EVENT));
}

export async function loadUserHighlights(
  documentId: string,
  options: { readonly includeDismissed?: boolean } = {},
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
    return records
      .filter((record) => options.includeDismissed === true || record.dismissed !== true)
      .map(upgradeHighlight)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
