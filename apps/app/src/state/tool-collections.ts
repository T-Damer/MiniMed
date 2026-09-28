/**
 * Version 1 of the doctor's favourites and collections: tool ids only. Kept to read what older
 * builds stored and what older backups contain; current data lives in item-collections.ts.
 */
export interface ToolCollection {
  readonly id: string;
  readonly name: string;
  readonly toolIds: readonly string[];
  readonly createdAt: string;
}

export interface ToolCollectionsState {
  readonly version: 1;
  readonly favorites: readonly string[];
  readonly collections: readonly ToolCollection[];
}

export const TOOL_COLLECTIONS_KEY = 'minimed.tool-collections.v1';
const TOOL_COLLECTION_NAME_MAX = 60;
const MAX_COLLECTIONS = 100;
const MAX_TOOLS_PER_LIST = 500;
const MAX_ID_LENGTH = 200;

export const EMPTY_TOOL_COLLECTIONS: ToolCollectionsState = {
  version: 1,
  favorites: [],
  collections: [],
};

function isToolId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function uniqueToolIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isToolId))].slice(0, MAX_TOOLS_PER_LIST);
}

function normalizeName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** Validates untrusted stored data; malformed entries are dropped, valid ones kept in order. */
export function parseToolCollections(raw: unknown): ToolCollectionsState {
  if (!raw || typeof raw !== 'object') return EMPTY_TOOL_COLLECTIONS;
  const candidate = raw as { version?: unknown; favorites?: unknown; collections?: unknown };
  if (candidate.version !== 1) return EMPTY_TOOL_COLLECTIONS;
  const seenIds = new Set<string>();
  const collections = (Array.isArray(candidate.collections) ? candidate.collections : [])
    .flatMap((entry: unknown): ToolCollection[] => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Partial<Record<keyof ToolCollection, unknown>>;
      if (!isToolId(item.id) || seenIds.has(item.id)) return [];
      if (typeof item.name !== 'string' || typeof item.createdAt !== 'string') return [];
      const name = normalizeName(item.name).slice(0, TOOL_COLLECTION_NAME_MAX);
      if (!name) return [];
      seenIds.add(item.id);
      return [
        { id: item.id, name, toolIds: uniqueToolIds(item.toolIds), createdAt: item.createdAt },
      ];
    })
    .slice(0, MAX_COLLECTIONS);
  return { version: 1, favorites: uniqueToolIds(candidate.favorites), collections };
}
