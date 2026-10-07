import type { SearchResponse } from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bumpSearchContentRevision,
  clearSearchResultCache,
  isFreshSearch,
  keysToEvict,
  readCachedSearch,
  searchCacheKey,
  searchContentSignature,
  writeCachedSearch,
} from '@/state/search-result-cache';

const response = {
  groups: [],
  identities: [],
  analysis: { originalQuery: 'пневмония' },
  modeUsed: 'lexical',
} as unknown as SearchResponse;

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});

afterEach(async () => {
  // No IndexedDB in the unit runner: the in-memory layer is what these tests exercise.
  await clearSearchResultCache();
  vi.unstubAllGlobals();
});

describe('saved search results', () => {
  it('keys a query by scope, specialty, filters and normalised text', () => {
    const base = { query: '  Пневмония  у детей', scope: 'all' as const };
    expect(searchCacheKey(base)).toBe(searchCacheKey({ ...base, query: 'пневмония у детей' }));
    expect(searchCacheKey(base)).not.toBe(searchCacheKey({ ...base, scope: 'guidelines' }));
    expect(searchCacheKey(base)).not.toBe(searchCacheKey({ ...base, specialty: 'педиатрия' }));
  });

  it('is fresh only with the same signature and for less than a day', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const savedAt = '2026-10-07T11:00:00Z';
    expect(isFreshSearch({ signature: 'a', savedAt }, 'a', now)).toBe(true);
    expect(isFreshSearch({ signature: 'a', savedAt }, 'b', now)).toBe(false);
    expect(isFreshSearch({ signature: 'a', savedAt: '2026-10-06T11:00:00Z' }, 'a', now)).toBe(
      false,
    );
  });

  it('evicts the oldest entries past the limit', () => {
    expect(
      keysToEvict(
        [
          { key: 'old', savedAt: '2026-10-01T00:00:00Z' },
          { key: 'new', savedAt: '2026-10-07T00:00:00Z' },
          { key: 'mid', savedAt: '2026-10-04T00:00:00Z' },
        ],
        2,
      ),
    ).toEqual(['old']);
  });

  it('turns stale when installed content changes', async () => {
    const identity = { query: 'пневмония', scope: 'all' as const };
    await writeCachedSearch(identity, response);
    expect((await readCachedSearch(identity))?.fresh).toBe(true);
    storage.set('minimed.search.content-revision.v1', 'before');
    const before = searchContentSignature();
    bumpSearchContentRevision();
    expect(searchContentSignature()).not.toBe(before);
    const saved = await readCachedSearch(identity);
    expect(saved?.response).toEqual(response);
    expect(saved?.fresh).toBe(false);
  });
});
