import type { SearchResponse } from '@localmed/contracts';

import type { SearchScope } from '@/features/search/ScopedMedicalCore';

/**
 * Device-local copies of finished searches (owner 2026-10-07, versioned 2026-10-08): a query asked
 * again — typed, from the history or after the app was closed — shows its results at once instead
 * of running the whole search and its skeleton again.
 *
 * An entry is keyed by the query as the search sees it (scope, specialty, filters, normalised
 * text) and by the data version it was made with (`search-data-version.ts`: build, core, installed
 * modules and their versions, semantic model). A copy made with other data is never read: every
 * write drops the entries of other data versions, and the newest-used {@link MAX_ENTRIES} stay
 * (LRU: a read counts as a use). So there is no stale copy to show, and the history needs none —
 * a previous search simply asks again and the cache answers only when the answer is still true.
 *
 * Kept in IndexedDB (a response is far over what localStorage takes), next to an in-memory map so
 * a repeat within the session needs no read at all. Holds query text like the search history and
 * is cleared with it; nothing here is logged.
 */
export const SEARCH_CACHE_DATABASE = 'minimed-search-results';
const DATABASE_VERSION = 2;
const STORE = 'searches';
export const MAX_ENTRIES = 50;
const USED_AT = 'usedAt';
const DATA_VERSION = 'dataVersion';

export interface SearchCacheIdentity {
  readonly query: string;
  readonly scope: SearchScope;
  readonly specialty?: string | undefined;
  readonly filters?: unknown;
}

interface StoredSearch {
  /** The identity and the data version: see {@link searchCacheKey}. */
  readonly key: string;
  readonly dataVersion: string;
  /** ISO time the search finished. */
  readonly savedAt: string;
  /** ISO time of the last write or read; the oldest are evicted first. */
  readonly usedAt: string;
  readonly response: SearchResponse;
}

export interface CachedSearch {
  readonly response: SearchResponse;
  readonly savedAt: string;
}

const memory = new Map<string, StoredSearch>();

/** One key per query as the search sees it, under one data version. */
export function searchCacheKey(identity: SearchCacheIdentity, dataVersion: string): string {
  const query = identity.query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU');
  return JSON.stringify([
    dataVersion,
    identity.scope,
    identity.specialty ?? '',
    identity.filters ?? {},
    query,
  ]);
}

/** Entries of other data versions: they can never be read again. */
export function staleKeys(
  entries: readonly Pick<StoredSearch, 'key' | 'dataVersion'>[],
  dataVersion: string,
): readonly string[] {
  return entries.filter((entry) => entry.dataVersion !== dataVersion).map((entry) => entry.key);
}

/** The least recently used keys past `limit`. */
export function keysToEvict(
  entries: readonly Pick<StoredSearch, 'key' | 'usedAt'>[],
  limit = MAX_ENTRIES,
): readonly string[] {
  return entries
    .toSorted((left, right) => right.usedAt.localeCompare(left.usedAt))
    .slice(limit)
    .map((entry) => entry.key);
}

function isStoredSearch(value: unknown): value is StoredSearch {
  if (!value || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, unknown>>;
  const response = record['response'] as Partial<SearchResponse> | undefined;
  return (
    typeof record['key'] === 'string' &&
    typeof record['dataVersion'] === 'string' &&
    typeof record['savedAt'] === 'string' &&
    typeof record['usedAt'] === 'string' &&
    !!response &&
    typeof response === 'object' &&
    Array.isArray(response.groups) &&
    typeof response.analysis?.originalQuery === 'string'
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка кэша результатов поиска.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const open = indexedDB.open(SEARCH_CACHE_DATABASE, DATABASE_VERSION);
  open.onupgradeneeded = () => {
    // Version 1 keyed entries without a data version; its copies are not carried over.
    if (open.result.objectStoreNames.contains(STORE)) open.result.deleteObjectStore(STORE);
    const store = open.result.createObjectStore(STORE, { keyPath: 'key' });
    store.createIndex(USED_AT, USED_AT);
    store.createIndex(DATA_VERSION, DATA_VERSION);
  };
  const database = await requestResult(open);
  try {
    const transaction = database.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Ошибка записи кэша поиска.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Запись кэша поиска прервана.'));
    });
    const result = await action(transaction.objectStore(STORE));
    await done;
    return result;
  } finally {
    database.close();
  }
}

function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Deletes every key an index range yields, reading keys only. */
function deleteKeysInRange(
  store: IDBObjectStore,
  index: string,
  range: IDBKeyRange,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = store.index(index).openKeyCursor(range);
    cursor.onerror = () => reject(cursor.error ?? new Error('Ошибка очистки кэша поиска.'));
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve();
        return;
      }
      store.delete(current.primaryKey);
      current.continue();
    };
  });
}

/** Drops the entries of other data versions and the least recently used past the limit. */
async function trimStore(store: IDBObjectStore, dataVersion: string): Promise<void> {
  await deleteKeysInRange(store, DATA_VERSION, IDBKeyRange.upperBound(dataVersion, true));
  await deleteKeysInRange(store, DATA_VERSION, IDBKeyRange.lowerBound(dataVersion, true));
  let excess = (await requestResult(store.count())) - MAX_ENTRIES;
  if (excess <= 0) return;
  // Oldest first through the `usedAt` index: only keys are read, never the stored responses.
  await new Promise<void>((resolve, reject) => {
    const cursor = store.index(USED_AT).openKeyCursor();
    cursor.onerror = () => reject(cursor.error ?? new Error('Ошибка очистки кэша поиска.'));
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || excess <= 0) {
        resolve();
        return;
      }
      store.delete(current.primaryKey);
      excess -= 1;
      current.continue();
    };
  });
}

function remember(record: StoredSearch): void {
  // Insertion order is recency: the map's first key is the least recently used.
  memory.delete(record.key);
  memory.set(record.key, record);
  for (const key of staleKeys([...memory.values()], record.dataVersion)) memory.delete(key);
  for (const key of keysToEvict([...memory.values()])) memory.delete(key);
}

/** The copy of a query made with this data version, or null. Reading it counts as a use. */
export async function readCachedSearch(
  identity: SearchCacheIdentity,
  dataVersion: string,
  now = Date.now(),
): Promise<CachedSearch | null> {
  const key = searchCacheKey(identity, dataVersion);
  let stored = memory.get(key);
  if (!stored && available()) {
    const value: unknown = await withStore('readonly', (store) => requestResult(store.get(key)));
    if (isStoredSearch(value) && value.dataVersion === dataVersion) stored = value;
  }
  if (!stored) return null;
  const used: StoredSearch = { ...stored, usedAt: new Date(now).toISOString() };
  remember(used);
  if (available()) {
    void withStore('readwrite', (store) => requestResult(store.put(used))).catch(
      (cause: unknown) => {
        console.error('Не удалось отметить использование сохранённого поиска.', cause);
      },
    );
  }
  return { response: used.response, savedAt: used.savedAt };
}

export async function writeCachedSearch(
  identity: SearchCacheIdentity,
  dataVersion: string,
  response: SearchResponse,
  now = Date.now(),
): Promise<void> {
  const stamp = new Date(now).toISOString();
  const record: StoredSearch = {
    key: searchCacheKey(identity, dataVersion),
    dataVersion,
    savedAt: stamp,
    usedAt: stamp,
    response,
  };
  remember(record);
  if (!available()) return;
  await withStore('readwrite', async (store) => {
    await requestResult(store.put(record));
    await trimStore(store, dataVersion);
  });
}

export async function clearSearchResultCache(): Promise<void> {
  memory.clear();
  if (!available()) return;
  await withStore('readwrite', (store) => requestResult(store.clear()));
}
