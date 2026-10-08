import { describe, expect, it } from 'vitest';

import {
  createBrowserNewsStorage,
  createMemoryNewsStorage,
  NEWS_ICONS_KEY,
  parseIcons,
} from '@/features/news/news-storage';
import type { StoredArticle } from '@/features/news/news-types';

const DATA = 'data:image/png;base64,iVBORwECAwQ=';

function article(itemId: string, feedId: string): StoredArticle {
  return { itemId, feedId, url: 'https://a.test/x', fetchedAt: 1, content: ['text'] };
}

describe('stored avatars', () => {
  it('keeps small image data URLs and records failed attempts without data', () => {
    expect(
      parseIcons({
        'a.test': { data: DATA, checkedAt: 5 },
        'b.test': { checkedAt: 6 },
        'c.test': { data: 'data:text/html;base64,AAAA', checkedAt: 7 },
        'd.test': { data: DATA },
        'e.test': 'nope',
      }),
    ).toEqual({
      'a.test': { data: DATA, checkedAt: 5 },
      'b.test': { checkedAt: 6 },
      'c.test': { checkedAt: 7 },
    });
    expect(parseIcons(null)).toEqual({});
    expect(parseIcons([])).toEqual({});
  });

  it('round-trips through localStorage and survives a broken value', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    } as unknown as Storage;
    const news = createBrowserNewsStorage({ storage, indexedDb: undefined });
    news.saveIcons({ 'a.test': { data: DATA, checkedAt: 3 } });
    expect(JSON.parse(values.get(NEWS_ICONS_KEY) ?? '{}')).toHaveProperty('a.test');
    expect(createBrowserNewsStorage({ storage, indexedDb: undefined }).loadIcons()).toEqual({
      'a.test': { data: DATA, checkedAt: 3 },
    });
    values.set(NEWS_ICONS_KEY, '{broken');
    expect(createBrowserNewsStorage({ storage, indexedDb: undefined }).loadIcons()).toEqual({});
  });
});

describe('stored articles (memory)', () => {
  it('saves per item, prunes what is no longer kept and deletes by feed', async () => {
    const storage = createMemoryNewsStorage();
    await storage.saveArticle(article('i1', 'f1'));
    await storage.saveArticle(article('i2', 'f1'));
    await storage.saveArticle(article('i3', 'f2'));
    await storage.pruneArticles('f1', new Set(['i1']));
    expect(await storage.loadArticle('i1')).toBeDefined();
    expect(await storage.loadArticle('i2')).toBeUndefined();
    expect(await storage.loadArticle('i3')).toBeDefined();
    await storage.deleteArticles('f1');
    expect(await storage.loadArticle('i1')).toBeUndefined();
    expect(await storage.loadArticle('i3')).toBeDefined();
  });
});
