import { safeLinkUrl } from '@/features/news/feed-content';
import type { FetchFailureCode, NewsItem, Subscription } from '@/features/news/news-types';

/**
 * Device-local persistence of the news feature (ADR-0024). Subscriptions (a few kilobytes: titles,
 * validators, unread counters) live in localStorage so the tab badge needs no database at start-up;
 * cached items (up to 200 per feed) live in IndexedDB, one record per feed. Nothing leaves the
 * device, and nothing is written before the user adds a subscription.
 */
export interface NewsStorage {
  loadSubscriptions(): readonly Subscription[];
  saveSubscriptions(subscriptions: readonly Subscription[]): void;
  loadItems(feedId: string): Promise<readonly NewsItem[]>;
  saveItems(feedId: string, items: readonly NewsItem[]): Promise<void>;
  deleteItems(feedId: string): Promise<void>;
}

export const NEWS_SUBSCRIPTIONS_KEY = 'minimed.news.subscriptions.v1';
export const NEWS_CHANGED_EVENT = 'minimed:news-changed';
const DB_NAME = 'minimed-news';
const DB_VERSION = 1;
const ITEMS_STORE = 'items';

const FAILURE_CODES: ReadonlySet<string> = new Set<FetchFailureCode>([
  'offline',
  'cors',
  'network',
  'timeout',
  'http',
  'too-large',
  'not-a-feed',
  'malformed',
  'empty',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

/** Validates what was stored; entries that do not fit the shape are dropped, never repaired silently into trusted data. */
export function parseSubscriptions(raw: unknown): readonly Subscription[] {
  if (!Array.isArray(raw)) return [];
  const out: Subscription[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = text(entry['id'], 80);
    const url = safeLinkUrl(text(entry['url'], 2048));
    const title = text(entry['title'], 300);
    const kind = entry['kind'];
    const addedAt = finiteNumber(entry['addedAt']);
    if (!id || !url || !/^https?:/u.test(url) || title === undefined) continue;
    if ((kind !== 'feed' && kind !== 'site') || addedAt === undefined || seen.has(id)) continue;
    seen.add(id);
    const siteUrl = safeLinkUrl(text(entry['siteUrl'], 2048));
    const language = text(entry['language'], 12);
    const suggestedId = text(entry['suggestedId'], 80);
    const fetchedAt = finiteNumber(entry['fetchedAt']);
    const etag = text(entry['etag'], 300);
    const lastModified = text(entry['lastModified'], 100);
    const errorRaw = entry['error'];
    const error =
      isRecord(errorRaw) &&
      typeof errorRaw['code'] === 'string' &&
      FAILURE_CODES.has(errorRaw['code']) &&
      typeof errorRaw['message'] === 'string' &&
      finiteNumber(errorRaw['at']) !== undefined
        ? {
            code: errorRaw['code'] as FetchFailureCode,
            message: errorRaw['message'].slice(0, 300),
            at: errorRaw['at'] as number,
          }
        : undefined;
    out.push({
      id,
      kind,
      url,
      title,
      ...(siteUrl ? { siteUrl } : {}),
      ...(language ? { language } : {}),
      ...(suggestedId ? { suggestedId } : {}),
      images: entry['images'] === true,
      addedAt,
      ...(fetchedAt !== undefined ? { fetchedAt } : {}),
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      ...(error ? { error } : {}),
      unread: Math.max(0, Math.floor(finiteNumber(entry['unread']) ?? 0)),
    });
  }
  return out;
}

function isStoredItem(value: unknown): value is NewsItem {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['feedId'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['snippet'] === 'string' &&
    Array.isArray(value['content']) &&
    finiteNumber(value['publishedAt']) !== undefined &&
    finiteNumber(value['firstSeenAt']) !== undefined &&
    typeof value['read'] === 'boolean'
  );
}

export function createMemoryNewsStorage(initial: readonly Subscription[] = []): NewsStorage {
  let subscriptions: readonly Subscription[] = initial;
  const items = new Map<string, readonly NewsItem[]>();
  return {
    loadSubscriptions: () => subscriptions,
    saveSubscriptions(next) {
      subscriptions = next;
    },
    async loadItems(feedId) {
      return items.get(feedId) ?? [];
    },
    async saveItems(feedId, next) {
      items.set(feedId, next);
    },
    async deleteItems(feedId) {
      items.delete(feedId);
    },
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ITEMS_STORE)) {
        request.result.createObjectStore(ITEMS_STORE, { keyPath: 'feedId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

/**
 * localStorage for subscriptions, IndexedDB for items. When IndexedDB is unavailable (private
 * windows, blocked site data) cached items stay in memory for the session and the feed still works.
 */
export function createBrowserNewsStorage(
  options: {
    readonly storage?: Storage | undefined;
    readonly indexedDb?: IDBFactory | undefined;
  } = {},
): NewsStorage {
  const fallback = createMemoryNewsStorage();
  let storage: Storage | undefined;
  try {
    storage = options.storage ?? globalThis.localStorage;
  } catch {
    storage = undefined;
  }
  let databasePromise: Promise<IDBDatabase | undefined> | undefined;
  const database = (): Promise<IDBDatabase | undefined> => {
    databasePromise ??= (async () => {
      try {
        const factory = options.indexedDb ?? globalThis.indexedDB;
        return factory ? await openDatabase(factory) : undefined;
      } catch {
        return undefined;
      }
    })();
    return databasePromise;
  };
  return {
    loadSubscriptions() {
      try {
        const raw = storage?.getItem(NEWS_SUBSCRIPTIONS_KEY);
        if (!raw) return fallback.loadSubscriptions();
        return parseSubscriptions(JSON.parse(raw));
      } catch {
        return fallback.loadSubscriptions();
      }
    },
    saveSubscriptions(subscriptions) {
      fallback.saveSubscriptions(subscriptions);
      try {
        storage?.setItem(NEWS_SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions));
      } catch {
        // Storage is full or blocked: the in-memory copy keeps this session consistent.
      }
    },
    async loadItems(feedId) {
      const db = await database();
      if (!db) return fallback.loadItems(feedId);
      try {
        const transaction = db.transaction(ITEMS_STORE, 'readonly');
        const record = await requestToPromise(transaction.objectStore(ITEMS_STORE).get(feedId));
        const stored = isRecord(record) && Array.isArray(record['items']) ? record['items'] : [];
        return stored.filter(isStoredItem);
      } catch {
        return fallback.loadItems(feedId);
      }
    },
    async saveItems(feedId, items) {
      await fallback.saveItems(feedId, items);
      const db = await database();
      if (!db) return;
      try {
        const transaction = db.transaction(ITEMS_STORE, 'readwrite');
        transaction.objectStore(ITEMS_STORE).put({ feedId, items });
        await transactionDone(transaction);
      } catch {
        // The in-memory copy still serves this session; the next successful save persists it.
      }
    },
    async deleteItems(feedId) {
      await fallback.deleteItems(feedId);
      const db = await database();
      if (!db) return;
      try {
        const transaction = db.transaction(ITEMS_STORE, 'readwrite');
        transaction.objectStore(ITEMS_STORE).delete(feedId);
        await transactionDone(transaction);
      } catch {
        // A failed delete leaves an orphan record that the next load never asks for.
      }
    },
  };
}

/** Unread total for the tab badge, read from localStorage only (no database, no service). */
export function readStoredUnreadCount(storage?: Storage): number {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(NEWS_SUBSCRIPTIONS_KEY);
    if (!raw) return 0;
    return parseSubscriptions(JSON.parse(raw)).reduce(
      (sum, subscription) => sum + (subscription.kind === 'feed' ? subscription.unread : 0),
      0,
    );
  } catch {
    return 0;
  }
}
