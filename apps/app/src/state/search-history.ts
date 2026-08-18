import type { SearchResponse } from '@localmed/contracts';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';

export interface SearchHistoryEntry {
  readonly id: string;
  readonly query: string;
  readonly scope: SearchScope;
  readonly createdAt: string;
  readonly resultCount: number;
  readonly modeUsed: SearchResponse['modeUsed'];
}

export interface SearchReplayDetail {
  readonly entry: SearchHistoryEntry;
  readonly cachedResponse?: SearchResponse;
}

export const SEARCH_HISTORY_KEY = 'localmed.search-history.v4';
export const SEARCH_HISTORY_EVENT = 'localmed:search-history-changed';
export const SEARCH_REPLAY_EVENT = 'localmed:replay-search';
const PREVIOUS_HISTORY_KEY = 'localmed.search-history.v3';
const LEGACY_HISTORY_KEY = 'localmed.search-history.v2';
const MAX_HISTORY = 40;
const responseCache = new Map<string, SearchResponse>();

function isScope(value: unknown): value is SearchScope {
  return ['diagnosis', 'guidelines', 'medications', 'legal', 'all', 'personal'].includes(
    String(value),
  );
}

function isHistoryEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SearchHistoryEntry>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.query === 'string' &&
    isScope(candidate.scope) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.resultCount === 'number' &&
    (candidate.modeUsed === 'lexical' ||
      candidate.modeUsed === 'semantic' ||
      candidate.modeUsed === 'hybrid')
  );
}

function migratePreviousHistory(): readonly SearchHistoryEntry[] {
  try {
    const previous: unknown = JSON.parse(localStorage.getItem(PREVIOUS_HISTORY_KEY) ?? '[]');
    if (!Array.isArray(previous)) return [];
    return previous
      .filter((item): item is Omit<SearchHistoryEntry, 'scope'> => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Partial<SearchHistoryEntry>;
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.query === 'string' &&
          typeof candidate.createdAt === 'string' &&
          typeof candidate.resultCount === 'number' &&
          (candidate.modeUsed === 'lexical' ||
            candidate.modeUsed === 'semantic' ||
            candidate.modeUsed === 'hybrid')
        );
      })
      .slice(0, MAX_HISTORY)
      .map((entry) => ({ ...entry, scope: 'all' }));
  } catch {
    return [];
  }
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
        scope: 'all' as const,
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
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) return value.filter(isHistoryEntry).slice(0, MAX_HISTORY);
    }
  } catch {
    // Fall through to the legacy migration.
  }
  const migrated = migratePreviousHistory();
  const fallback = migrated.length > 0 ? migrated : migrateLegacyHistory();
  if (fallback.length > 0) localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(fallback));
  return fallback;
}

export function appendSearchHistory(
  query: string,
  scope: SearchScope,
  response: SearchResponse,
): readonly SearchHistoryEntry[] {
  const trimmed = query.trim();
  const current = loadSearchHistory();
  const nextEntry: SearchHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query: trimmed,
    scope,
    createdAt: new Date().toISOString(),
    resultCount: response.groups.length,
    modeUsed: response.modeUsed,
  };
  const next = [
    nextEntry,
    ...current.filter((entry) => entry.query !== trimmed || entry.scope !== scope),
  ].slice(0, MAX_HISTORY);
  for (const entry of current) {
    if (entry.query === trimmed && entry.scope === scope) responseCache.delete(entry.id);
  }
  responseCache.set(nextEntry.id, response);
  const retainedIds = new Set(next.map((entry) => entry.id));
  for (const id of responseCache.keys()) {
    if (!retainedIds.has(id)) responseCache.delete(id);
  }
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SEARCH_HISTORY_EVENT, { detail: next }));
  return next;
}

export function clearSearchHistory(): void {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  localStorage.removeItem(PREVIOUS_HISTORY_KEY);
  localStorage.removeItem(LEGACY_HISTORY_KEY);
  responseCache.clear();
  window.dispatchEvent(new CustomEvent(SEARCH_HISTORY_EVENT, { detail: [] }));
}

export function removeSearchHistoryEntry(id: string): readonly SearchHistoryEntry[] {
  responseCache.delete(id);
  const next = loadSearchHistory().filter((entry) => entry.id !== id);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SEARCH_HISTORY_EVENT, { detail: next }));
  return next;
}

export function replaySearch(entry: SearchHistoryEntry): void {
  const cachedResponse = responseCache.get(entry.id);
  window.dispatchEvent(
    new CustomEvent<SearchReplayDetail>(SEARCH_REPLAY_EVENT, {
      detail: cachedResponse ? { entry, cachedResponse } : { entry },
    }),
  );
}
