import type { SearchResponse } from '@localmed/contracts';

import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import { RELEASE_VERSION } from '../../../../release';

/**
 * Device-local copies of finished searches (owner 2026-10-07): a query asked again — typed, from
 * the history or after the app was closed — shows its last results at once instead of running the
 * whole search and its skeleton again. A copy is «fresh» while the app version and the installed
 * content are the ones it was made with (and for at most a day); a stale copy is still shown at
 * once, and the search re-runs behind it with the usual «Есть новые результаты» offer.
 *
 * Kept in IndexedDB (a response is far over what localStorage takes), next to an in-memory map so
 * a repeat within the session needs no read at all. Holds query text like the search history and
 * is cleared with it; nothing here is logged.
 */
export const SEARCH_CACHE_DATABASE = 'minimed-search-results';
const STORE = 'searches';
const MAX_ENTRIES = 40;
const FRESH_MS = 24 * 60 * 60 * 1000;
const REVISION_KEY = 'minimed.search.content-revision.v1';
const SAVED_AT = 'savedAt';

export interface SearchCacheIdentity {
  readonly query: string;
  readonly scope: SearchScope;
  readonly specialty?: string | undefined;
  readonly filters?: unknown;
}

interface StoredSearch {
  readonly key: string;
  readonly signature: string;
  /** ISO time the search finished. */
  readonly savedAt: string;
  readonly response: SearchResponse;
}

export interface CachedSearch {
  readonly response: SearchResponse;
  readonly savedAt: string;
  /** Same app version and installed content, younger than a day: no need to search again. */
  readonly fresh: boolean;
}

const memory = new Map<string, StoredSearch>();

function readRevision(): string {
  try {
    return localStorage.getItem(REVISION_KEY) ?? '0';
  } catch (cause) {
    console.warn('Search cache revision is unavailable.', cause);
    return '0';
  }
}

/** Installed content changed (a module, the core, the semantic model): every copy turns stale. */
export function bumpSearchContentRevision(): void {
  try {
    localStorage.setItem(REVISION_KEY, String(Date.now()));
  } catch (cause) {
    console.warn('Search cache revision could not be saved.', cause);
  }
}

export function searchContentSignature(): string {
  return `${RELEASE_VERSION}|${readRevision()}`;
}

/** One key per query as the search sees it: scope, specialty, filters and the normalised text. */
export function searchCacheKey(identity: SearchCacheIdentity): string {
  const query = identity.query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU');
  return JSON.stringify([identity.scope, identity.specialty ?? '', identity.filters ?? {}, query]);
}

export function isFreshSearch(
  stored: Pick<StoredSearch, 'signature' | 'savedAt'>,
  signature: string,
  now: number,
): boolean {
  const age = now - Date.parse(stored.savedAt);
  return stored.signature === signature && age >= 0 && age < FRESH_MS;
}

function isStoredSearch(value: unknown): value is StoredSearch {
  if (!value || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, unknown>>;
  const response = record['response'] as Partial<SearchResponse> | undefined;
  return (
    typeof record['key'] === 'string' &&
    typeof record['signature'] === 'string' &&
    typeof record['savedAt'] === 'string' &&
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
  const open = indexedDB.open(SEARCH_CACHE_DATABASE, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex(SAVED_AT, SAVED_AT);
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

export async function readCachedSearch(
  identity: SearchCacheIdentity,
  now = Date.now(),
): Promise<CachedSearch | null> {
  const key = searchCacheKey(identity);
  let stored = memory.get(key);
  if (!stored && available()) {
    const value: unknown = await withStore('readonly', (store) => requestResult(store.get(key)));
    if (isStoredSearch(value)) {
      stored = value;
      memory.set(key, value);
    }
  }
  if (!stored) return null;
  return {
    response: stored.response,
    savedAt: stored.savedAt,
    fresh: isFreshSearch(stored, searchContentSignature(), now),
  };
}

/** The newest `MAX_ENTRIES` keys stay; the rest are removed. */
export function keysToEvict(
  entries: readonly Pick<StoredSearch, 'key' | 'savedAt'>[],
  limit = MAX_ENTRIES,
): readonly string[] {
  return entries
    .toSorted((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(limit)
    .map((entry) => entry.key);
}

export async function writeCachedSearch(
  identity: SearchCacheIdentity,
  response: SearchResponse,
  now = Date.now(),
): Promise<void> {
  const record: StoredSearch = {
    key: searchCacheKey(identity),
    signature: searchContentSignature(),
    savedAt: new Date(now).toISOString(),
    response,
  };
  memory.set(record.key, record);
  for (const key of keysToEvict([...memory.values()])) memory.delete(key);
  if (!available()) return;
  await withStore('readwrite', async (store) => {
    await requestResult(store.put(record));
    let excess = (await requestResult(store.count())) - MAX_ENTRIES;
    if (excess <= 0) return;
    // Oldest first through the `savedAt` index: only keys are read, never the stored responses.
    const cursor = store.index(SAVED_AT).openKeyCursor();
    await new Promise<void>((resolve, reject) => {
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
  });
}

export async function clearSearchResultCache(): Promise<void> {
  memory.clear();
  if (!available()) return;
  await withStore('readwrite', (store) => requestResult(store.clear()));
}
