import { type QuickTool, resolveItemRefs } from '@/features/search/quick-tools';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import type { ItemCollectionsState, ItemRef } from '@/state/item-collections';

/** Title of the favourites section and of the Files folder that opens it. */
export const FAVORITES_SECTION_TITLE = 'Избранные';

/** One saved item as a row: what it is called, what it is, and how it opens. */
export interface SavedEntry {
  readonly ref: ItemRef;
  readonly tool: QuickTool;
}

/** Favourites or one named collection, with the entries that can still be opened. */
export interface SavedSection {
  /** `favorites` or the collection id. */
  readonly id: string;
  readonly title: string;
  readonly entries: readonly SavedEntry[];
}

function entriesOf(
  items: readonly ItemRef[],
  toolsById: ReadonlyMap<string, QuickTool>,
): readonly SavedEntry[] {
  return resolveItemRefs(items, toolsById).flatMap((resolved) =>
    resolved.tool ? [{ ref: resolved.ref, tool: resolved.tool }] : [],
  );
}

/**
 * Favourites first, then the doctor's collections. An item that left the catalog (a calculator
 * that no longer ships) is not listed: there is nothing to open. With a query, a section whose
 * name matches is kept whole and any other section keeps only the entries whose title matches.
 */
export function buildSavedSections(
  state: ItemCollectionsState,
  toolsById: ReadonlyMap<string, QuickTool>,
  query = '',
): readonly SavedSection[] {
  const all: readonly SavedSection[] = [
    {
      id: 'favorites',
      title: FAVORITES_SECTION_TITLE,
      entries: entriesOf(state.favorites, toolsById),
    },
    ...state.collections.map((collection) => ({
      id: collection.id,
      title: collection.name,
      entries: entriesOf(collection.items, toolsById),
    })),
  ];
  const text = query.trim();
  // Favourites are listed only when there is something in them; a collection stays even when it
  // is empty, because it was made on purpose.
  if (!text)
    return all.filter((section) => section.id !== 'favorites' || section.entries.length > 0);
  return all.flatMap((section) => {
    if (matchesFuzzyQuery(text, [section.title])) {
      return section.entries.length > 0 ? [section] : [];
    }
    const entries = section.entries.filter((entry) =>
      matchesFuzzyQuery(text, [entry.tool.title, entry.tool.kindLabel]),
    );
    return entries.length > 0 ? [{ ...section, entries }] : [];
  });
}

/** Every distinct saved item whose title matches, once, however many places hold it. */
export function searchSavedItems(
  state: ItemCollectionsState,
  toolsById: ReadonlyMap<string, QuickTool>,
  query: string,
): readonly SavedEntry[] {
  const text = query.trim();
  if (!text) return [];
  const seen = new Set<string>();
  const found: SavedEntry[] = [];
  for (const section of buildSavedSections(state, toolsById, text)) {
    for (const entry of section.entries) {
      const key = `${entry.ref.kind}:${entry.ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(entry);
    }
  }
  return found;
}

/** How many distinct items are saved anywhere, for the count on the Files folder. */
export function savedItemCount(
  state: ItemCollectionsState,
  toolsById: ReadonlyMap<string, QuickTool>,
): number {
  const seen = new Set<string>();
  for (const section of buildSavedSections(state, toolsById)) {
    for (const entry of section.entries) seen.add(`${entry.ref.kind}:${entry.ref.id}`);
  }
  return seen.size;
}
