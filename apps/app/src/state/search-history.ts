import type { SearchResponse } from '@localmed/contracts';

export interface SearchHistoryEntry {
  readonly id: string;
  readonly query: string;
  readonly createdAt: string;
  readonly resultCount: number;
  readonly modeUsed: SearchResponse['modeUsed'];
}

export const SEARCH_HISTORY_KEY = 'localmed.search-history.v3';
export const SEARCH_HISTORY_EVENT = 'localmed:search-history-changed';
export const SEARCH_REPLAY_EVENT = 'localmed:replay-search';
const LEGACY_HISTORY_KEY = 'localmed.search-history.v2';
const MAX_HISTORY = 40;

function isHistoryEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SearchHistoryEntry>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.query === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.resultCount === 'number' &&
    (candidate.modeUsed === 'lexical' ||
      candidate.modeUsed === 'semantic' ||
      candidate.modeUsed === 'hybrid')
  );
}

function migrateLegacyHistory(): readonly SearchHistoryEntry[] {
  try {
    const legacy: unknown = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY) ?? '[]');
    if (!Array.isArray(legacy)) return [];
    const baseTime = Date.now();
    return legacy
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, MAX_HISTORY)
      .map((query, index) => ({
        id: `legacy-${baseTime}-${index}`,
        query,
        createdAt: new Date(baseTime - index * 1_000).toISOString(),
        resultCount: 0,
        modeUsed: 'lexical' as const,
      }));
  } catch {
    return [];
  }
}

export function loadSearchHistory(): readonly SearchHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? '[]');
    if (Array.isArray(value)) {
      const entries = value.filter(isHistoryEntry).slice(0, MAX_HISTORY);
      if (entries.length > 0) return entries;
    }
  } catch {
    // Fall through to the legacy migration.
  }
  const migrated = migrateLegacyHistory();
  if (migrated.length > 0) localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(migrated));
  return migrated;
}

export function appendSearchHistory(
  query: string,
  response: Pick<SearchResponse, 'groups' | 'modeUsed'>,
): readonly SearchHistoryEntry[] {
  const trimmed = query.trim();
  const current = loadSearchHistory();
  const nextEntry: SearchHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query: trimmed,
    createdAt: new Date().toISOString(),
    resultCount: response.groups.length,
    modeUsed: response.modeUsed,
  };
  const next = [nextEntry, ...current.filter((entry) => entry.query !== trimmed)].slice(0, MAX_HISTORY);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SEARCH_HISTORY_EVENT, { detail: next }));
  return next;
}

export function clearSearchHistory(): void {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  localStorage.removeItem(LEGACY_HISTORY_KEY);
  window.dispatchEvent(new CustomEvent(SEARCH_HISTORY_EVENT, { detail: [] }));
}

export function removeSearchHistoryEntry(id: string): readonly SearchHistoryEntry[] {
  const next = loadSearchHistory().filter((entry) => entry.id !== id);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SEARCH_HISTORY_EVENT, { detail: next }));
  return next;
}

export function replaySearch(query: string): void {
  window.dispatchEvent(new CustomEvent<string>(SEARCH_REPLAY_EVENT, { detail: query }));
}
