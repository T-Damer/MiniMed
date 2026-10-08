import { safeLinkUrl } from '@/features/news/feed-content';
import { isStoredIconData } from '@/features/news/news-icons';
import {
  type FetchFailureCode,
  hasItems,
  type NewsItem,
  type StoredArticle,
  type StoredIcon,
  type Subscription,
  type SubscriptionKind,
} from '@/features/news/news-types';

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
  /** Source avatars by site host: small data URLs, a few kilobytes each. */
  loadIcons(): Readonly<Record<string, StoredIcon>>;
  saveIcons(icons: Readonly<Record<string, StoredIcon>>): void;
  /** Extracted article pages, one record per item (kept apart from the items they belong to). */
  loadArticle(itemId: string): Promise<StoredArticle | undefined>;
  saveArticle(article: StoredArticle): Promise<void>;
  /** Drops the articles of `feedId` whose item is no longer kept. */
  pruneArticles(feedId: string, keepItemIds: ReadonlySet<string>): Promise<void>;
  deleteArticles(feedId: string): Promise<void>;
}

export const NEWS_SUBSCRIPTIONS_KEY = 'minimed.news.subscriptions.v1';
export const NEWS_ICONS_KEY = 'minimed.news.icons.v1';
export const NEWS_CHANGED_EVENT = 'minimed:news-changed';
const DB_NAME = 'minimed-news';
const DB_VERSION = 2;
const ITEMS_STORE = 'items';
const ARTICLES_STORE = 'articles';
const ARTICLES_BY_FEED = 'feedId';

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

function isSubscriptionKind(value: unknown): value is SubscriptionKind {
  return value === 'feed' || value === 'site' || value === 'pubmed';
}

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
    if (!isSubscriptionKind(kind) || addedAt === undefined || seen.has(id)) continue;
    const query = text(entry['query'], 300);
    if (kind === 'pubmed' && (!query || query.trim() === '')) continue;
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
      ...(kind === 'pubmed' && query ? { query } : {}),
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

/** Validates stored avatars: only small image data URLs survive. */
export function parseIcons(raw: unknown): Readonly<Record<string, StoredIcon>> {
  if (!isRecord(raw)) return {};
  const out: Record<string, StoredIcon> = {};
  for (const [host, value] of Object.entries(raw)) {
    if (!isRecord(value) || host.length > 253) continue;
    const checkedAt = finiteNumber(value['checkedAt']);
    if (checkedAt === undefined) continue;
    const data = value['data'];
    out[host] = isStoredIconData(data) ? { data, checkedAt } : { checkedAt };
  }
  return out;
}

function isStoredArticle(value: unknown): value is StoredArticle {
  return (
    isRecord(value) &&
    typeof value['itemId'] === 'string' &&
    typeof value['feedId'] === 'string' &&
    typeof value['url'] === 'string' &&
    finiteNumber(value['fetchedAt']) !== undefined &&
    Array.isArray(value['content'])
  );
}

export function createMemoryNewsStorage(initial: readonly Subscription[] = []): NewsStorage {
  let subscriptions: readonly Subscription[] = initial;
  let icons: Readonly<Record<string, StoredIcon>> = {};
  const items = new Map<string, readonly NewsItem[]>();
  const articles = new Map<string, StoredArticle>();
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
    loadIcons: () => icons,
    saveIcons(next) {
      icons = next;
    },
    async loadArticle(itemId) {
      return articles.get(itemId);
    },
    async saveArticle(article) {
      articles.set(article.itemId, article);
    },
    async pruneArticles(feedId, keepItemIds) {
      for (const [itemId, article] of articles) {
        if (article.feedId === feedId && !keepItemIds.has(itemId)) articles.delete(itemId);
      }
    },
    async deleteArticles(feedId) {
      for (const [itemId, article] of articles) {
        if (article.feedId === feedId) articles.delete(itemId);
      }
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
      if (!request.result.objectStoreNames.contains(ARTICLES_STORE)) {
        const articles = request.result.createObjectStore(ARTICLES_STORE, { keyPath: 'itemId' });
        articles.createIndex(ARTICLES_BY_FEED, 'feedId');
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
    loadIcons() {
      try {
        const raw = storage?.getItem(NEWS_ICONS_KEY);
        if (!raw) return fallback.loadIcons();
        return parseIcons(JSON.parse(raw));
      } catch {
        return fallback.loadIcons();
      }
    },
    saveIcons(icons) {
      fallback.saveIcons(icons);
      try {
        storage?.setItem(NEWS_ICONS_KEY, JSON.stringify(icons));
      } catch {
        // Storage is full or blocked: avatars stay in memory for this session.
      }
    },
    async loadArticle(itemId) {
      const db = await database();
      if (!db) return fallback.loadArticle(itemId);
      try {
        const transaction = db.transaction(ARTICLES_STORE, 'readonly');
        const record = await requestToPromise(transaction.objectStore(ARTICLES_STORE).get(itemId));
        return isStoredArticle(record) ? record : undefined;
      } catch {
        return fallback.loadArticle(itemId);
      }
    },
    async saveArticle(article) {
      await fallback.saveArticle(article);
      const db = await database();
      if (!db) return;
      try {
        const transaction = db.transaction(ARTICLES_STORE, 'readwrite');
        transaction.objectStore(ARTICLES_STORE).put(article);
        await transactionDone(transaction);
      } catch {
        // The in-memory copy still serves this session.
      }
    },
    async pruneArticles(feedId, keepItemIds) {
      await fallback.pruneArticles(feedId, keepItemIds);
      const db = await database();
      if (!db) return;
      try {
        const transaction = db.transaction(ARTICLES_STORE, 'readwrite');
        const store = transaction.objectStore(ARTICLES_STORE);
        const keys = await requestToPromise(
          store.index(ARTICLES_BY_FEED).getAllKeys(IDBKeyRange.only(feedId)),
        );
        for (const key of keys) {
          if (typeof key === 'string' && !keepItemIds.has(key)) store.delete(key);
        }
        await transactionDone(transaction);
      } catch {
        // Orphaned articles are harmless: nothing asks for an item that is gone.
      }
    },
    async deleteArticles(feedId) {
      await fallback.deleteArticles(feedId);
      await this.pruneArticles(feedId, new Set());
    },
  };
}

/** Unread total for the tab badge, read from localStorage only (no database, no service). */
export function readStoredUnreadCount(storage?: Storage): number {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(NEWS_SUBSCRIPTIONS_KEY);
    if (!raw) return 0;
    return parseSubscriptions(JSON.parse(raw)).reduce(
      (sum, subscription) => sum + (hasItems(subscription.kind) ? subscription.unread : 0),
      0,
    );
  } catch {
    return 0;
  }
}
