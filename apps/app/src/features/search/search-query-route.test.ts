import { describe, expect, it } from 'vitest';

import {
  hashPath,
  hashWithSearchQuery,
  isSearchHash,
  searchQueryFromHash,
} from './search-query-route';

describe('search query in the address', () => {
  it('writes and reads Cyrillic, spaces and symbols', () => {
    for (const query of ['Аспирин', 'боль в груди при вдохе', 'J05.8 + «грипп»', 'a&b=c?d#e']) {
      const hash = hashWithSearchQuery('#/search', query);
      expect(hash.startsWith('#/search?q=')).toBe(true);
      expect(hash.slice(1)).not.toMatch(/[\s#]/u);
      expect(searchQueryFromHash(hash)).toBe(query);
    }
  });

  it('keeps the path of a section and drops the parameter for an empty query', () => {
    const hash = hashWithSearchQuery('#/search/section/medications', 'варфарин');
    expect(hashPath(hash)).toBe('#/search/section/medications');
    expect(searchQueryFromHash(hash)).toBe('варфарин');
    expect(hashWithSearchQuery(hash, '  ')).toBe('#/search/section/medications');
    expect(hashWithSearchQuery(hash, undefined)).toBe('#/search/section/medications');
  });

  it('replaces an earlier query instead of adding a second parameter', () => {
    const first = hashWithSearchQuery('#/search', 'аспирин');
    const second = hashWithSearchQuery(first, 'варфарин');
    expect(second.match(/\?/gu)).toHaveLength(1);
    expect(searchQueryFromHash(second)).toBe('варфарин');
  });

  it('reads only search addresses and tolerates damaged ones', () => {
    expect(isSearchHash('#/search')).toBe(true);
    expect(isSearchHash('#/search?q=x')).toBe(true);
    expect(isSearchHash('#/search/section/legal?q=x')).toBe(true);
    expect(isSearchHash('#/calculators?q=x')).toBe(false);
    expect(searchQueryFromHash('#/calculators?q=x')).toBeUndefined();
    expect(searchQueryFromHash('#/search?q=')).toBeUndefined();
    expect(searchQueryFromHash('#/search?x=1')).toBeUndefined();
    expect(searchQueryFromHash('#/search?q=%E0%A4%A')).toBeDefined();
    expect(searchQueryFromHash('#/search')).toBeUndefined();
  });

  it('caps the length of the query', () => {
    const long = 'а'.repeat(1000);
    expect(searchQueryFromHash(hashWithSearchQuery('#/search', long))?.length).toBe(300);
  });
});
