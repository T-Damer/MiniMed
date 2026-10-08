import type { SearchResponse } from '@localmed/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearSearchResultCache,
  keysToEvict,
  MAX_ENTRIES,
  readCachedSearch,
  searchCacheKey,
  staleKeys,
  writeCachedSearch,
} from '@/state/search-result-cache';

function responseFor(query: string): SearchResponse {
  return {
    groups: [],
    identities: [],
    analysis: { originalQuery: query },
    modeUsed: 'lexical',
  } as unknown as SearchResponse;
}

const V1 = 'app:0.6.57|core:1|modules:3.aaaa|semantic:off';
const V2 = 'app:0.6.57|core:1|modules:4.bbbb|semantic:off';

afterEach(async () => {
  // No IndexedDB in the unit runner: the in-memory layer is what these tests exercise.
  await clearSearchResultCache();
});

describe('search cache keys', () => {
  it('keys a query by data version, scope, specialty, filters and normalised text', () => {
    const base = { query: '  Пневмония  у детей', scope: 'all' as const };
    const key = searchCacheKey(base, V1);
    expect(key).toBe(searchCacheKey({ ...base, query: 'пневмония у детей' }, V1));
    expect(key).not.toBe(searchCacheKey(base, V2));
    expect(key).not.toBe(searchCacheKey({ ...base, scope: 'guidelines' }, V1));
    expect(key).not.toBe(searchCacheKey({ ...base, specialty: 'педиатрия' }, V1));
    expect(key).not.toBe(searchCacheKey({ ...base, filters: { specialties: ['x'] } }, V1));
  });
});

describe('cache housekeeping', () => {
  it('lists the entries of other data versions as stale', () => {
    expect(
      staleKeys(
        [
          { key: 'old', dataVersion: V1 },
          { key: 'current', dataVersion: V2 },
          { key: 'older', dataVersion: 'v0' },
        ],
        V2,
      ),
    ).toEqual(['old', 'older']);
  });

  it('evicts the least recently used entries past the limit', () => {
    expect(
      keysToEvict(
        [
          { key: 'old', usedAt: '2026-10-01T00:00:00Z' },
          { key: 'new', usedAt: '2026-10-07T00:00:00Z' },
          { key: 'mid', usedAt: '2026-10-04T00:00:00Z' },
        ],
        2,
      ),
    ).toEqual(['old']);
  });
});

describe('saved search results', () => {
  const identity = { query: 'пневмония', scope: 'all' as const };

  it('answers a repeat made with the same data and with no other', async () => {
    await writeCachedSearch(identity, V1, responseFor('пневмония'));
    expect((await readCachedSearch(identity, V1))?.response.analysis.originalQuery).toBe(
      'пневмония',
    );
    expect(await readCachedSearch(identity, V2)).toBeNull();
  });

  it('drops the copies of earlier data when a search is saved under new data', async () => {
    await writeCachedSearch(identity, V1, responseFor('пневмония'));
    await writeCachedSearch({ ...identity, query: 'астма' }, V2, responseFor('астма'));
    // The earlier data came back (an install undone): its copy is gone, not resurrected.
    expect(await readCachedSearch(identity, V1)).toBeNull();
    expect(await readCachedSearch({ ...identity, query: 'астма' }, V2)).not.toBeNull();
  });

  it('keeps the 50 most recently used searches', async () => {
    for (let index = 0; index < MAX_ENTRIES; index += 1) {
      await writeCachedSearch(
        { ...identity, query: `запрос ${index}` },
        V1,
        responseFor(`запрос ${index}`),
        Date.UTC(2026, 9, 8, 12, 0, index),
      );
    }
    // Reading the oldest makes it the newest; the next write evicts the second-oldest instead.
    expect(
      await readCachedSearch({ ...identity, query: 'запрос 0' }, V1, Date.UTC(2026, 9, 8, 13)),
    ).not.toBeNull();
    await writeCachedSearch(
      { ...identity, query: 'запрос 50' },
      V1,
      responseFor('запрос 50'),
      Date.UTC(2026, 9, 8, 13, 0, 1),
    );
    expect(await readCachedSearch({ ...identity, query: 'запрос 0' }, V1)).not.toBeNull();
    expect(await readCachedSearch({ ...identity, query: 'запрос 1' }, V1)).toBeNull();
    expect(await readCachedSearch({ ...identity, query: 'запрос 2' }, V1)).not.toBeNull();
    expect(await readCachedSearch({ ...identity, query: 'запрос 50' }, V1)).not.toBeNull();
  });
});
