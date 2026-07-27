import type { SearchResponse } from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendSearchHistory,
  loadSearchHistory,
  replaySearch,
  SEARCH_HISTORY_KEY,
  SEARCH_REPLAY_EVENT,
} from '@/state/search-history';

const RESPONSE: SearchResponse = {
  requestId: 'request-1',
  normalizedQuery: 'приказ',
  elapsedMs: 4,
  modeUsed: 'lexical',
  analysis: {
    originalQuery: 'приказ',
    normalizedQuery: 'приказ',
    facts: [],
    branches: [],
    suggestions: [],
    warnings: [],
  },
  suggestions: [],
  groups: [],
  diagnostics: {
    ftsQuery: 'приказ',
    candidateCount: 0,
    aliasMatches: [],
    terms: ['приказ'],
    branches: [],
    semantic: {
      status: 'disabled',
      requestedMode: 'auto',
      profileId: null,
      candidateCount: 0,
      elapsedMs: 0,
      fallbackReason: null,
    },
  },
};

describe('search history', () => {
  const storage = new Map<string, string>();
  const dispatched: Event[] = [];

  beforeEach(() => {
    storage.clear();
    dispatched.length = 0;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        dispatched.push(event);
        return true;
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('preserves the selected scope and replays the cached response', () => {
    const [entry] = appendSearchHistory('приказ', 'legal', RESPONSE);
    expect(loadSearchHistory()[0]?.scope).toBe('legal');

    if (!entry) throw new Error('history entry missing');
    replaySearch(entry);
    const replay = dispatched.find((event) => event.type === SEARCH_REPLAY_EVENT) as
      | CustomEvent
      | undefined;
    expect(replay?.detail).toEqual({ entry, cachedResponse: RESPONSE });
  });

  it('migrates v3 entries to the safe all-documents scope', () => {
    storage.set(
      'localmed.search-history.v3',
      JSON.stringify([
        {
          id: 'old',
          query: 'пневмония',
          createdAt: '2026-07-27T00:00:00.000Z',
          resultCount: 2,
          modeUsed: 'lexical',
        },
      ]),
    );
    expect(loadSearchHistory()[0]?.scope).toBe('all');
    expect(storage.has(SEARCH_HISTORY_KEY)).toBe(true);
  });

  it('does not resurrect v3 history after the current list becomes empty', () => {
    storage.set(SEARCH_HISTORY_KEY, '[]');
    storage.set(
      'localmed.search-history.v3',
      JSON.stringify([
        {
          id: 'old',
          query: 'пневмония',
          createdAt: '2026-07-27T00:00:00.000Z',
          resultCount: 2,
          modeUsed: 'lexical',
        },
      ]),
    );
    expect(loadSearchHistory()).toEqual([]);
  });
});
