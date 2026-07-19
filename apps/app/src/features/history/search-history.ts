import type { SearchResponse } from '@localmed/contracts';

export interface SearchHistoryEntry {
  readonly id: string;
  readonly query: string;
  readonly searchedAt: string;
  readonly resultCount: number;
  readonly candidateCount: number;
  readonly modeUsed: SearchResponse['modeUsed'];
}

const HISTORY_KEY = 'localmed.search-history.v3';
const MAX_HISTORY_ENTRIES = 40;

function isEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SearchHistoryEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.query === 'string' &&
    typeof entry.searchedAt === 'string' &&
    typeof entry.resultCount === 'number' &&
    typeof entry.candidateCount === 'number' &&
    (entry.modeUsed === 'lexical' || entry.modeUsed === 'semantic' || entry.modeUsed === 'hybrid')
  );
}

export function readSearchHistory(): readonly SearchHistoryEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isEntry).slice(0, MAX_HISTORY_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function recordSearchHistory(
  current: readonly SearchHistoryEntry[],
  input: Omit<SearchHistoryEntry, 'id' | 'searchedAt'>,
): readonly SearchHistoryEntry[] {
  const searchedAt = new Date().toISOString();
  const entry: SearchHistoryEntry = {
    ...input,
    searchedAt,
    id: `${searchedAt}:${input.query}`,
  };
  const normalized = input.query.trim().toLocaleLowerCase('ru-RU');
  const next = [
    entry,
    ...current.filter((item) => item.query.trim().toLocaleLowerCase('ru-RU') !== normalized),
  ].slice(0, MAX_HISTORY_ENTRIES);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function clearSearchHistory(): readonly SearchHistoryEntry[] {
  localStorage.removeItem(HISTORY_KEY);
  return [];
}
