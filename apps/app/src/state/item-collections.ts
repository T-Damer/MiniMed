import { createSignal } from 'solid-js';

import { parseToolCollections, TOOL_COLLECTIONS_KEY } from '@/state/tool-collections';

/**
 * Favourites and user-named collections of anything a doctor keeps coming back to — tools,
 * documents, medication cards, personal notes — stored only on this device. An entry references its item by a
 * stable id and keeps a title snapshot, so an item that later leaves the catalog stays listed and
 * marked unavailable instead of silently disappearing.
 */
export type ItemKind = 'tool' | 'document' | 'note';

export interface ItemRef {
  readonly kind: ItemKind;
  /** Catalog tool id, stable document id or personal note id; never a position in a list. */
  readonly id: string;
  /** Title when the item was added; tools resolve their live catalog title instead. */
  readonly title?: string;
  /** Search result kind of a document (medication, clinical-recommendation, …), for its icon. */
  readonly documentKind?: string;
  /** Where the item lives, when its id alone cannot open it: the patient card of a note. */
  readonly parentId?: string;
  readonly addedAt: string;
}

export interface ItemCollection {
  readonly id: string;
  readonly name: string;
  readonly items: readonly ItemRef[];
  readonly createdAt: string;
}

export interface ItemCollectionsState {
  readonly version: 2;
  readonly favorites: readonly ItemRef[];
  readonly collections: readonly ItemCollection[];
}

/** What callers pass to add an item: everything but the time it was added. */
export type ItemRefInput = Omit<ItemRef, 'addedAt'>;

export const ITEM_COLLECTIONS_KEY = 'minimed.collections.v2';
export const ITEM_COLLECTIONS_EVENT = 'minimed:item-collections-changed';
export const COLLECTION_NAME_MAX = 60;
const MAX_COLLECTIONS = 100;
const MAX_ITEMS_PER_LIST = 500;
const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 300;

export const EMPTY_ITEM_COLLECTIONS: ItemCollectionsState = {
  version: 2,
  favorites: [],
  collections: [],
};

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function sameItem(left: Pick<ItemRef, 'kind' | 'id'>, right: Pick<ItemRef, 'kind' | 'id'>) {
  return left.kind === right.kind && left.id === right.id;
}

function parseItemRef(value: unknown): ItemRef | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<Record<keyof ItemRef, unknown>>;
  if ((item.kind !== 'tool' && item.kind !== 'document' && item.kind !== 'note') || !isId(item.id))
    return null;
  if (typeof item.addedAt !== 'string') return null;
  return {
    kind: item.kind,
    id: item.id,
    addedAt: item.addedAt,
    ...(typeof item.title === 'string' && item.title.trim()
      ? { title: item.title.trim().slice(0, MAX_TITLE_LENGTH) }
      : {}),
    ...(isId(item.documentKind) ? { documentKind: item.documentKind } : {}),
    ...(isId(item.parentId) ? { parentId: item.parentId } : {}),
  };
}

function uniqueItems(value: unknown): readonly ItemRef[] {
  if (!Array.isArray(value)) return [];
  const items: ItemRef[] = [];
  for (const candidate of value) {
    const item = parseItemRef(candidate);
    if (item && !items.some((existing) => sameItem(existing, item))) items.push(item);
  }
  return items.slice(0, MAX_ITEMS_PER_LIST);
}

function normalizeName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * Validates untrusted stored data; malformed entries are dropped, valid ones kept in order. A
 * version-1 tool list is migrated: its tool ids become tool items, nothing is lost.
 */
export function parseItemCollections(raw: unknown, migratedAt = ''): ItemCollectionsState {
  if (!raw || typeof raw !== 'object') return EMPTY_ITEM_COLLECTIONS;
  const candidate = raw as { version?: unknown; favorites?: unknown; collections?: unknown };
  if (candidate.version === 1) return migrateToolCollections(raw, migratedAt);
  if (candidate.version !== 2) return EMPTY_ITEM_COLLECTIONS;
  const seenIds = new Set<string>();
  const collections = (Array.isArray(candidate.collections) ? candidate.collections : [])
    .flatMap((entry: unknown): ItemCollection[] => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Partial<Record<keyof ItemCollection, unknown>>;
      if (!isId(item.id) || seenIds.has(item.id)) return [];
      if (typeof item.name !== 'string' || typeof item.createdAt !== 'string') return [];
      const name = normalizeName(item.name).slice(0, COLLECTION_NAME_MAX);
      if (!name) return [];
      seenIds.add(item.id);
      return [{ id: item.id, name, items: uniqueItems(item.items), createdAt: item.createdAt }];
    })
    .slice(0, MAX_COLLECTIONS);
  return { version: 2, favorites: uniqueItems(candidate.favorites), collections };
}

/** Version 1 kept only tool ids; each becomes a tool item added at the migration time. */
export function migrateToolCollections(raw: unknown, migratedAt: string): ItemCollectionsState {
  const legacy = parseToolCollections(raw);
  const toItems = (ids: readonly string[]): readonly ItemRef[] =>
    ids.map((id) => ({ kind: 'tool', id, addedAt: migratedAt }));
  return {
    version: 2,
    favorites: toItems(legacy.favorites),
    collections: legacy.collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      items: toItems(collection.toolIds),
      createdAt: collection.createdAt,
    })),
  };
}

export function isFavoriteItem(
  state: ItemCollectionsState,
  item: Pick<ItemRef, 'kind' | 'id'>,
): boolean {
  return state.favorites.some((entry) => sameItem(entry, item));
}

export function toggleFavoriteItem(
  state: ItemCollectionsState,
  item: ItemRefInput,
  addedAt: string,
): ItemCollectionsState {
  return {
    ...state,
    favorites: isFavoriteItem(state, item)
      ? state.favorites.filter((entry) => !sameItem(entry, item))
      : [...state.favorites, { ...item, addedAt }].slice(0, MAX_ITEMS_PER_LIST),
  };
}

/** A user-facing reason the name cannot be used, or undefined when it is acceptable. */
export function collectionNameError(
  state: ItemCollectionsState,
  name: string,
  exceptId?: string,
): string | undefined {
  const normalized = normalizeName(name);
  if (!normalized) return 'Введите название коллекции.';
  if (normalized.length > COLLECTION_NAME_MAX)
    return `Название длиннее ${COLLECTION_NAME_MAX} символов.`;
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

export function createCollection(
  state: ItemCollectionsState,
  name: string,
  options: {
    readonly id: string;
    readonly createdAt: string;
    readonly items?: readonly ItemRefInput[];
  },
): ItemCollectionsState {
  const error = collectionNameError(state, name);
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
        items: uniqueItems(
          (options.items ?? []).map((item) => ({ ...item, addedAt: options.createdAt })),
        ),
        createdAt: options.createdAt,
      },
    ],
  };
}

export function renameCollection(
  state: ItemCollectionsState,
  collectionId: string,
  name: string,
): ItemCollectionsState {
  const error = collectionNameError(state, name, collectionId);
  if (error) throw new Error(error);
  return {
    ...state,
    collections: state.collections.map((collection) =>
      collection.id === collectionId ? { ...collection, name: normalizeName(name) } : collection,
    ),
  };
}

export function deleteCollection(
  state: ItemCollectionsState,
  collectionId: string,
): ItemCollectionsState {
  return {
    ...state,
    collections: state.collections.filter((collection) => collection.id !== collectionId),
  };
}

/** Adds or removes one item; an item may belong to any number of collections. */
export function setItemInCollection(
  state: ItemCollectionsState,
  collectionId: string,
  item: ItemRefInput,
  included: boolean,
  addedAt: string,
): ItemCollectionsState {
  return {
    ...state,
    collections: state.collections.map((collection) => {
      if (collection.id !== collectionId) return collection;
      const present = collection.items.some((entry) => sameItem(entry, item));
      if (present === included) return collection;
      return {
        ...collection,
        items: included
          ? [...collection.items, { ...item, addedAt }].slice(0, MAX_ITEMS_PER_LIST)
          : collection.items.filter((entry) => !sameItem(entry, item)),
      };
    }),
  };
}

export function collectionIdsContaining(
  state: ItemCollectionsState,
  item: Pick<ItemRef, 'kind' | 'id'>,
): ReadonlySet<string> {
  return new Set(
    state.collections
      .filter((collection) => collection.items.some((entry) => sameItem(entry, item)))
      .map((collection) => collection.id),
  );
}

interface CollectionsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): CollectionsStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

/** Reads one stored list; unreadable JSON is reported by error type only, never its content. */
function readStored(storage: CollectionsStorage, key: string): unknown {
  const raw = storage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (cause) {
    console.warn(
      `Stored collections (${key}) are unreadable: ${cause instanceof Error ? cause.name : 'unknown error'}. Starting from an empty list.`,
    );
    return undefined;
  }
}

/**
 * The version-2 list, or — on the first run after the update — the version-1 tool list migrated.
 * The version-1 entry is left in place, so an older build can still read it.
 */
export function loadItemCollections(
  storage: CollectionsStorage | undefined = defaultStorage(),
  now: () => string = () => new Date().toISOString(),
): ItemCollectionsState {
  if (!storage) return EMPTY_ITEM_COLLECTIONS;
  const current = readStored(storage, ITEM_COLLECTIONS_KEY);
  if (current !== undefined) return parseItemCollections(current, now());
  const legacy = readStored(storage, TOOL_COLLECTIONS_KEY);
  return legacy === undefined ? EMPTY_ITEM_COLLECTIONS : migrateToolCollections(legacy, now());
}

export function saveItemCollections(
  state: ItemCollectionsState,
  storage: CollectionsStorage | undefined = defaultStorage(),
): void {
  storage?.setItem(ITEM_COLLECTIONS_KEY, JSON.stringify(state));
}

const [current, setCurrent] = createSignal<ItemCollectionsState>(loadItemCollections());
let listening = false;

function listenForExternalChanges(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // Another tab or window of the app changed the same list.
  window.addEventListener('storage', (event) => {
    if (event.key === ITEM_COLLECTIONS_KEY) setCurrent(loadItemCollections());
  });
}

/** Tracked accessor for UI; changes go through {@link updateItemCollections}. */
export function itemCollections(): ItemCollectionsState {
  listenForExternalChanges();
  return current();
}

/** Applies a pure transform, persists it, and notifies listeners. Throws on invalid input. */
export function updateItemCollections(
  transform: (state: ItemCollectionsState) => ItemCollectionsState,
): ItemCollectionsState {
  const next = transform(current());
  saveItemCollections(next);
  setCurrent(next);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ITEM_COLLECTIONS_EVENT));
  return next;
}

/** Replaces the whole list, e.g. from a validated backup of either version. */
export function replaceItemCollections(raw: unknown): ItemCollectionsState {
  return updateItemCollections(() => parseItemCollections(raw, new Date().toISOString()));
}
