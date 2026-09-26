import { createSignal } from 'solid-js';

/**
 * Favourite tools and user-named tool collections, kept only on this device. Entries reference a
 * tool by its stable catalog id; a tool that later disappears from the catalog stays listed so the
 * UI can mark it unavailable instead of silently dropping the doctor's choice.
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
export const TOOL_COLLECTIONS_EVENT = 'minimed:tool-collections-changed';
export const TOOL_COLLECTION_NAME_MAX = 60;
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

export function isFavoriteTool(state: ToolCollectionsState, toolId: string): boolean {
  return state.favorites.includes(toolId);
}

export function toggleFavoriteTool(
  state: ToolCollectionsState,
  toolId: string,
): ToolCollectionsState {
  return {
    ...state,
    favorites: state.favorites.includes(toolId)
      ? state.favorites.filter((id) => id !== toolId)
      : [...state.favorites, toolId].slice(0, MAX_TOOLS_PER_LIST),
  };
}

/** A user-facing reason the name cannot be used, or undefined when it is acceptable. */
export function toolCollectionNameError(
  state: ToolCollectionsState,
  name: string,
  exceptId?: string,
): string | undefined {
  const normalized = normalizeName(name);
  if (!normalized) return 'Введите название коллекции.';
  if (normalized.length > TOOL_COLLECTION_NAME_MAX)
    return `Название длиннее ${TOOL_COLLECTION_NAME_MAX} символов.`;
  const folded = normalized.toLocaleLowerCase('ru-RU');
  if (
    state.collections.some(
      (collection) =>
        collection.id !== exceptId && collection.name.toLocaleLowerCase('ru-RU') === folded,
    )
  )
    return 'Коллекция с таким названием уже есть.';
  return undefined;
}

export function createToolCollection(
  state: ToolCollectionsState,
  name: string,
  options: {
    readonly id: string;
    readonly createdAt: string;
    readonly toolIds?: readonly string[];
  },
): ToolCollectionsState {
  const error = toolCollectionNameError(state, name);
  if (error) throw new Error(error);
  if (state.collections.length >= MAX_COLLECTIONS)
    throw new Error(`Можно создать не больше ${MAX_COLLECTIONS} коллекций.`);
  if (state.collections.some((collection) => collection.id === options.id))
    throw new Error('Коллекция с таким идентификатором уже есть.');
  return {
    ...state,
    collections: [
      ...state.collections,
      {
        id: options.id,
        name: normalizeName(name),
        toolIds: uniqueToolIds(options.toolIds ?? []),
        createdAt: options.createdAt,
      },
    ],
  };
}

export function renameToolCollection(
  state: ToolCollectionsState,
  collectionId: string,
  name: string,
): ToolCollectionsState {
  const error = toolCollectionNameError(state, name, collectionId);
  if (error) throw new Error(error);
  return {
    ...state,
    collections: state.collections.map((collection) =>
      collection.id === collectionId ? { ...collection, name: normalizeName(name) } : collection,
    ),
  };
}

export function deleteToolCollection(
  state: ToolCollectionsState,
  collectionId: string,
): ToolCollectionsState {
  return {
    ...state,
    collections: state.collections.filter((collection) => collection.id !== collectionId),
  };
}

/** Adds or removes one tool; a tool may belong to any number of collections. */
export function setToolInCollection(
  state: ToolCollectionsState,
  collectionId: string,
  toolId: string,
  included: boolean,
): ToolCollectionsState {
  return {
    ...state,
    collections: state.collections.map((collection) => {
      if (collection.id !== collectionId) return collection;
      const present = collection.toolIds.includes(toolId);
      if (present === included) return collection;
      return {
        ...collection,
        toolIds: included
          ? [...collection.toolIds, toolId].slice(0, MAX_TOOLS_PER_LIST)
          : collection.toolIds.filter((id) => id !== toolId),
      };
    }),
  };
}

export function collectionIdsContainingTool(
  state: ToolCollectionsState,
  toolId: string,
): ReadonlySet<string> {
  return new Set(
    state.collections
      .filter((collection) => collection.toolIds.includes(toolId))
      .map((collection) => collection.id),
  );
}

interface ToolCollectionsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ToolCollectionsStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

export function loadToolCollections(
  storage: ToolCollectionsStorage | undefined = defaultStorage(),
): ToolCollectionsState {
  const raw = storage?.getItem(TOOL_COLLECTIONS_KEY);
  if (!raw) return EMPTY_TOOL_COLLECTIONS;
  try {
    return parseToolCollections(JSON.parse(raw));
  } catch (cause) {
    console.warn('Stored tool collections are unreadable; starting from an empty list.', cause);
    return EMPTY_TOOL_COLLECTIONS;
  }
}

export function saveToolCollections(
  state: ToolCollectionsState,
  storage: ToolCollectionsStorage | undefined = defaultStorage(),
): void {
  storage?.setItem(TOOL_COLLECTIONS_KEY, JSON.stringify(state));
}

const [current, setCurrent] = createSignal<ToolCollectionsState>(loadToolCollections());
let listening = false;

function listenForExternalChanges(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // Another tab or window of the app changed the same list.
  window.addEventListener('storage', (event) => {
    if (event.key === TOOL_COLLECTIONS_KEY) setCurrent(loadToolCollections());
  });
}

/** Tracked accessor for UI; changes go through {@link updateToolCollections}. */
export function toolCollections(): ToolCollectionsState {
  listenForExternalChanges();
  return current();
}

/** Applies a pure transform, persists it, and notifies listeners. Throws on invalid input. */
export function updateToolCollections(
  transform: (state: ToolCollectionsState) => ToolCollectionsState,
): ToolCollectionsState {
  const next = transform(current());
  saveToolCollections(next);
  setCurrent(next);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TOOL_COLLECTIONS_EVENT));
  return next;
}

/** Replaces the whole list, e.g. from a validated backup. */
export function replaceToolCollections(raw: unknown): ToolCollectionsState {
  return updateToolCollections(() => parseToolCollections(raw));
}
