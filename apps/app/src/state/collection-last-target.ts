import type { ItemCollection, ItemRef } from '@/state/item-collections';

/**
 * Where the doctor last saved an item of each kind — medication cards, guidelines, notes — so the
 * save panel offers that place first next time. Only collection ids are stored, never content.
 */
export const COLLECTION_LAST_TARGET_KEY = 'minimed.collections.last-target.v1';
export const FAVORITES_TARGET = 'favorites';

/** Items of one kind share a memory: a medication card and a guideline are remembered apart. */
export function lastTargetKey(item: Pick<ItemRef, 'kind' | 'documentKind'>): string {
  return item.documentKind ? `${item.kind}:${item.documentKind}` : item.kind;
}

export type LastTargets = Readonly<Record<string, string>>;

interface TargetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TargetStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

export function parseLastTargets(raw: unknown): LastTargets {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        entry[0].length <= 80 && typeof entry[1] === 'string' && entry[1].length <= 200,
    ),
  );
}

export function loadLastTargets(storage = defaultStorage()): LastTargets {
  const raw = storage?.getItem(COLLECTION_LAST_TARGET_KEY);
  if (!raw) return {};
  try {
    return parseLastTargets(JSON.parse(raw));
  } catch (cause) {
    console.warn(
      `Stored save targets are unreadable: ${cause instanceof Error ? cause.name : 'unknown error'}.`,
    );
    return {};
  }
}

export function rememberLastTarget(
  item: Pick<ItemRef, 'kind' | 'documentKind'>,
  target: string,
  storage = defaultStorage(),
): void {
  storage?.setItem(
    COLLECTION_LAST_TARGET_KEY,
    JSON.stringify({ ...loadLastTargets(storage), [lastTargetKey(item)]: target }),
  );
}

/** The remembered collection first, the rest in their own order; a deleted target is ignored. */
export function orderByLastTarget(
  collections: readonly ItemCollection[],
  lastTarget: string | undefined,
): readonly ItemCollection[] {
  const remembered = collections.find((collection) => collection.id === lastTarget);
  return remembered
    ? [remembered, ...collections.filter((collection) => collection !== remembered)]
    : collections;
}
