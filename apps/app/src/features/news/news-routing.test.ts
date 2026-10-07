import { describe, expect, it } from 'vitest';

import {
  isNewsRoute,
  newsItemHash,
  newsParentHash,
  newsSiteHash,
  readNewsRoute,
} from '@/features/news/news-routing';

describe('news routes', () => {
  it('reads the list, add, sources, item and site routes', () => {
    expect(readNewsRoute('#/news')).toEqual({ kind: 'list' });
    expect(readNewsRoute('#/news/add')).toEqual({ kind: 'add' });
    expect(readNewsRoute('#/news/sources')).toEqual({ kind: 'sources' });
    expect(readNewsRoute('#/news/pubmed')).toEqual({ kind: 'pubmed' });
    expect(readNewsRoute(newsItemHash('i-abc/def'))).toEqual({ kind: 'item', itemId: 'i-abc/def' });
    expect(readNewsRoute(newsSiteHash('s-1'))).toEqual({ kind: 'site', feedId: 's-1' });
    expect(readNewsRoute('#/news/item')).toEqual({ kind: 'list' });
    expect(readNewsRoute('#/news/item/%E0%A4%A')).toEqual({ kind: 'list' });
  });

  it('recognises news routes only', () => {
    expect(isNewsRoute('#/news/add')).toBe(true);
    expect(isNewsRoute('news')).toBe(true);
    expect(isNewsRoute('#/newsroom')).toBe(false);
    expect(isNewsRoute('#/settings')).toBe(false);
  });

  it('leads every sub-route back to the list, and the list nowhere', () => {
    expect(newsParentHash('news/add')).toBe('#/news');
    expect(newsParentHash('news/sources')).toBe('#/news');
    expect(newsParentHash('news/pubmed')).toBe('#/news');
    expect(newsParentHash('news/item/i-1')).toBe('#/news');
    expect(newsParentHash('news/site/s-1')).toBe('#/news');
    expect(newsParentHash('news')).toBeNull();
    expect(newsParentHash('settings')).toBeNull();
  });
});
