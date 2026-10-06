import {
  type UserLibraryDocument,
  type UserLibraryExampleSlot,
  type UserLibraryFileKind,
  type UserLibraryFolder,
  userLibraryFileKind,
} from '@/state/user-library';

export type LibrarySortMode = 'time' | 'name' | 'type';

/**
 * One tile of «Ваши документы»: a folder, a document or a not-yet-downloaded example. It only
 * points at its record; title and time are read from the record when sorting, so an entry object
 * can stay the same while its document's fields change.
 */
export interface LibraryEntry {
  readonly key: string;
  readonly kind: 'folder' | 'document';
  readonly folder?: UserLibraryFolder;
  readonly document?: UserLibraryDocument;
  readonly example?: UserLibraryExampleSlot;
}

/** Examples sort after every real file in time order. */
const EXAMPLE_UPDATED_AT = '9999-12-31T23:59:59.999Z';

/** Folders lead, then Office colors-first kinds, everything else follows. */
const FILE_KIND_SORT_RANK: Record<UserLibraryFileKind | 'folder', number> = {
  folder: 0,
  presentation: 1,
  sheet: 2,
  doc: 3,
  pdf: 4,
  dicom: 5,
  volume: 6,
  ebook: 7,
  image: 8,
  text: 9,
  code: 10,
  audio: 11,
  video: 12,
  archive: 13,
  binary: 14,
  questionnaire: 15,
};

export function libraryEntryTitle(entry: LibraryEntry): string {
  return entry.folder?.title ?? entry.document?.title ?? entry.example?.title ?? '';
}

function libraryEntryUpdatedAt(entry: LibraryEntry): string {
  if (entry.example) return EXAMPLE_UPDATED_AT;
  return entry.folder?.updatedAt ?? entry.document?.updatedAt ?? '';
}

function libraryEntryRank(entry: LibraryEntry): number {
  if (entry.kind === 'folder') return FILE_KIND_SORT_RANK.folder;
  const record = entry.example ?? entry.document;
  return FILE_KIND_SORT_RANK[
    record ? userLibraryFileKind(record.mimeType, record.fileName) : 'binary'
  ];
}

export function sortLibraryEntries(
  entries: readonly LibraryEntry[],
  mode: LibrarySortMode,
): readonly LibraryEntry[] {
  const byTitle = (left: LibraryEntry, right: LibraryEntry): number =>
    libraryEntryTitle(left).localeCompare(libraryEntryTitle(right), 'ru-RU');
  return entries.toSorted((left, right) => {
    if (mode === 'name') return byTitle(left, right);
    if (mode === 'type') {
      return libraryEntryRank(left) - libraryEntryRank(right) || byTitle(left, right);
    }
    return (
      libraryEntryUpdatedAt(right).localeCompare(libraryEntryUpdatedAt(left)) ||
      byTitle(left, right)
    );
  });
}

/**
 * Returns `next` with every entry that points at the same record as an entry of `previous`
 * replaced by that previous object. Keyed lists (`<For>`, the virtualizer rows) then keep a card's
 * DOM node — and keyboard focus on its «⋯» — while its document is read, previewed or patched.
 * Records must keep their identity across refreshes (a store reconciled by id).
 */
export function reuseLibraryEntries(
  previous: readonly LibraryEntry[],
  next: readonly LibraryEntry[],
): readonly LibraryEntry[] {
  if (previous.length === 0) return next;
  const previousByKey = new Map(previous.map((entry) => [entry.key, entry]));
  return next.map((entry) => {
    const kept = previousByKey.get(entry.key);
    return kept &&
      kept.kind === entry.kind &&
      kept.folder === entry.folder &&
      kept.document === entry.document &&
      kept.example === entry.example
      ? kept
      : entry;
  });
}
