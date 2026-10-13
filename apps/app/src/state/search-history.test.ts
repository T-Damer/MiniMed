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

  it('preserves the selected scope and replays by asking again, with no stored response', () => {
    const [entry] = appendSearchHistory('приказ', 'legal', RESPONSE);
    expect(loadSearchHistory()[0]?.scope).toBe('legal');

    if (!entry) throw new Error('history entry missing');
    replaySearch(entry);
    const replay = dispatched.find((event) => event.type === SEARCH_REPLAY_EVENT) as
      | CustomEvent
      | undefined;
    expect(replay?.detail).toEqual({ entry });
  });

  it('keeps different subsections and tool searches', () => {
    appendSearchHistory('риск', 'calculators', 3, 'cardiology');
    appendSearchHistory('риск', 'calculators', 2, 'obstetrics');
    appendSearchHistory('риск', 'calculators', 4, 'cardiology');
    expect(
      loadSearchHistory().map(({ specialty, resultCount }) => ({ specialty, resultCount })),
    ).toEqual([
      { specialty: 'cardiology', resultCount: 4 },
      { specialty: 'obstetrics', resultCount: 2 },
    ]);
    const entry = loadSearchHistory()[0];
    if (!entry) throw new Error('missing tool history');
    replaySearch(entry);
    expect((dispatched.at(-1) as CustomEvent).detail).toEqual({ entry });
  });

  it('records a search whose typing paused, and replaces it while the words are extended', () => {
    appendSearchHistory('пневм', 'all', 3, undefined, { auto: true });
    appendSearchHistory('пневмония', 'all', 5, undefined, { auto: true });
    expect(loadSearchHistory().map((entry) => entry.query)).toEqual(['пневмония']);
    // The doctor presses Enter on the same words: still one entry.
    appendSearchHistory('пневмония', 'all', 5);
    expect(loadSearchHistory()).toHaveLength(1);
    // A different thought is a new entry.
    appendSearchHistory('амоксициллин', 'all', 4, undefined, { auto: true });
    expect(loadSearchHistory().map((entry) => entry.query)).toEqual(['амоксициллин', 'пневмония']);
  });

  it('keeps an explicit search when a longer one follows', () => {
    appendSearchHistory('астма', 'all', 3);
    appendSearchHistory('астма у детей', 'all', 3, undefined, { auto: true });
    expect(loadSearchHistory().map((entry) => entry.query)).toEqual(['астма у детей', 'астма']);
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
