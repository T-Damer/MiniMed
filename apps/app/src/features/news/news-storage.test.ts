import { describe, expect, it } from 'vitest';

import {
  createBrowserNewsStorage,
  createMemoryNewsStorage,
  NEWS_SUBSCRIPTIONS_KEY,
  parseSubscriptions,
  readStoredUnreadCount,
} from '@/features/news/news-storage';
import type { NewsItem, Subscription } from '@/features/news/news-types';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const valid: Subscription = {
  id: 's-1',
  kind: 'feed',
  url: 'https://a.example/feed',
  title: 'A',
  images: true,
  addedAt: 1,
  fetchedAt: 2,
  etag: '"e"',
  unread: 4,
};

const item: NewsItem = {
  id: 'i-1',
  feedId: 's-1',
  title: 'T',
  snippet: '',
  content: [],
  publishedAt: 1,
  firstSeenAt: 1,
  read: false,
};

describe('parseSubscriptions', () => {
  it('accepts a valid record and drops malformed ones', () => {
    const parsed = parseSubscriptions([
      valid,
      { ...valid, id: 's-2', url: 'javascript:alert(1)' },
      { ...valid, id: 's-3', kind: 'other' },
      { ...valid, id: 's-4', title: 5 },
      { ...valid, id: 's-1' },
      'garbage',
      null,
    ]);
    expect(parsed).toEqual([valid]);
  });

  it('normalizes counters and error records', () => {
    const [parsed] = parseSubscriptions([
      { ...valid, unread: -3, error: { code: 'cors', message: 'm', at: 5 } },
    ]);
    expect(parsed?.unread).toBe(0);
    expect(parsed?.error).toEqual({ code: 'cors', message: 'm', at: 5 });
    const [bad] = parseSubscriptions([
      { ...valid, error: { code: 'unknown', message: 'm', at: 5 } },
    ]);
    expect(bad?.error).toBeUndefined();
  });

  it('returns nothing for non-arrays', () => {
    expect(parseSubscriptions({})).toEqual([]);
    expect(parseSubscriptions(undefined)).toEqual([]);
  });
});

describe('storages', () => {
  it('keeps items per feed in memory and deletes them', async () => {
    const storage = createMemoryNewsStorage();
    await storage.saveItems('s-1', [item]);
    expect(await storage.loadItems('s-1')).toEqual([item]);
    await storage.deleteItems('s-1');
    expect(await storage.loadItems('s-1')).toEqual([]);
  });

  it('persists subscriptions in localStorage and falls back to memory for items without IndexedDB', async () => {
    const local = fakeStorage();
    const storage = createBrowserNewsStorage({ storage: local, indexedDb: undefined });
    expect(storage.loadSubscriptions()).toEqual([]);
    storage.saveSubscriptions([valid]);
    expect(JSON.parse(local.getItem(NEWS_SUBSCRIPTIONS_KEY) ?? '[]')).toHaveLength(1);
    await storage.saveItems('s-1', [item]);
    expect(await storage.loadItems('s-1')).toEqual([item]);
    const reopened = createBrowserNewsStorage({ storage: local, indexedDb: undefined });
    expect(reopened.loadSubscriptions()).toEqual([valid]);
  });

  it('survives corrupted stored JSON', () => {
    const storage = createBrowserNewsStorage({
      storage: fakeStorage({ [NEWS_SUBSCRIPTIONS_KEY]: '{not json' }),
      indexedDb: undefined,
    });
    expect(storage.loadSubscriptions()).toEqual([]);
  });

  it('reads the tab badge from localStorage alone', () => {
    const local = fakeStorage({
      [NEWS_SUBSCRIPTIONS_KEY]: JSON.stringify([
        valid,
        { ...valid, id: 's-2', url: 'https://b.example/', kind: 'site', unread: 50 },
        { ...valid, id: 's-3', url: 'https://c.example/feed', unread: 2 },
      ]),
    });
    expect(readStoredUnreadCount(local)).toBe(6);
    expect(readStoredUnreadCount(fakeStorage())).toBe(0);
  });
});
