import { describe, expect, it } from 'vitest';
import {
  type LibraryEntry,
  libraryEntryTitle,
  reuseLibraryEntries,
  sortLibraryEntries,
} from '@/features/library/user-library-entries';
import type { UserLibraryDocument, UserLibraryFolder } from '@/state/user-library';

function documentRecord(
  id: string,
  title: string,
  updatedAt: string,
  mimeType = 'application/pdf',
): UserLibraryDocument {
  return {
    id,
    title,
    fileName: `${title}.${mimeType === 'image/png' ? 'png' : 'pdf'}`,
    mimeType,
    byteLength: 1,
    pageCount: 1,
    nativeTextPages: 1,
    ocrDonePages: 0,
    ocrNeededPages: 0,
    status: 'ready',
    createdAt: updatedAt,
    updatedAt,
  } as UserLibraryDocument;
}

const folder: UserLibraryFolder = {
  id: 'folder',
  title: 'Яблоки',
  parentId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const documentEntry = (document: UserLibraryDocument): LibraryEntry => ({
  key: document.id,
  kind: 'document',
  document,
});

describe('sortLibraryEntries', () => {
  const older = documentRecord('older', 'Бета', '2026-10-02T00:00:00.000Z');
  const newer = documentRecord('newer', 'Альфа', '2026-10-03T00:00:00.000Z');
  const image = documentRecord('image', 'Аа', '2026-10-04T00:00:00.000Z', 'image/png');
  const entries: readonly LibraryEntry[] = [
    documentEntry(older),
    { key: folder.id, kind: 'folder', folder },
    documentEntry(newer),
    documentEntry(image),
  ];

  it('orders by time, newest first', () => {
    expect(sortLibraryEntries(entries, 'time').map((entry) => entry.key)).toEqual([
      'image',
      'newer',
      'older',
      'folder',
    ]);
  });

  it('orders by name', () => {
    expect(sortLibraryEntries(entries, 'name').map(libraryEntryTitle)).toEqual([
      'Аа',
      'Альфа',
      'Бета',
      'Яблоки',
    ]);
  });

  it('orders by type with folders first', () => {
    expect(sortLibraryEntries(entries, 'type').map((entry) => entry.key)).toEqual([
      'folder',
      'newer',
      'older',
      'image',
    ]);
  });
});

describe('reuseLibraryEntries', () => {
  it('keeps the previous object for an entry whose record is the same', () => {
    const record = documentRecord('a', 'Альфа', '2026-10-02T00:00:00.000Z');
    const other = documentRecord('b', 'Бета', '2026-10-02T00:00:00.000Z');
    const previous = [documentEntry(record), documentEntry(other)];
    const next = reuseLibraryEntries(previous, [documentEntry(other), documentEntry(record)]);
    expect(next[0]).toBe(previous[1]);
    expect(next[1]).toBe(previous[0]);
  });

  it('takes the new object when the key now points at another record', () => {
    const record = documentRecord('a', 'Альфа', '2026-10-02T00:00:00.000Z');
    const replaced = documentRecord('a', 'Альфа', '2026-10-03T00:00:00.000Z');
    const previous = [documentEntry(record)];
    const fresh = documentEntry(replaced);
    expect(reuseLibraryEntries(previous, [fresh])[0]).toBe(fresh);
  });
});
