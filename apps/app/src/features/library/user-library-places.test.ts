import { describe, expect, it } from 'vitest';

import {
  parseUserLibraryPlace,
  USER_LIBRARY_KIND_GROUPS,
  userLibraryKindCounts,
  userLibraryKindGroup,
  userLibraryPlaceHash,
} from '@/features/library/user-library-places';
import type { UserLibraryFileKind } from '@/state/user-library-capabilities';

const ALL_KINDS: readonly UserLibraryFileKind[] = [
  'questionnaire',
  'pdf',
  'dicom',
  'volume',
  'image',
  'video',
  'audio',
  'archive',
  'code',
  'presentation',
  'sheet',
  'doc',
  'ebook',
  'text',
  'binary',
];

describe('«Файлы» by kind', () => {
  it('puts every file kind into exactly one section', () => {
    for (const kind of ALL_KINDS) {
      const holding = USER_LIBRARY_KIND_GROUPS.filter((group) => group.kinds.includes(kind));
      expect(holding, kind).toHaveLength(1);
      expect(userLibraryKindGroup(kind)).toBe(holding[0]);
    }
  });

  it('counts files per section in the declared order and leaves empty sections out', () => {
    expect(
      userLibraryKindCounts(['image', 'pdf', 'dicom', 'text', 'audio']).map(({ group, count }) => [
        group.id,
        count,
      ]),
    ).toEqual([
      ['documents', 2],
      ['images', 2],
      ['audio', 1],
    ]);
    expect(userLibraryKindCounts([])).toEqual([]);
  });
});

describe('«Файлы» places in the address', () => {
  it('round-trips a kind section and the computer', () => {
    for (const place of [
      { kind: 'folders' },
      { kind: 'kind', group: 'images' },
      { kind: 'computer' },
    ] as const) {
      const route = userLibraryPlaceHash(place).replace(/^#\//u, '');
      expect(parseUserLibraryPlace(route)).toEqual(place);
    }
  });

  it('reads an unknown section or a folder address as the folder tree', () => {
    expect(parseUserLibraryPlace('modules/documents/user?kind=nope')).toEqual({ kind: 'folders' });
    expect(parseUserLibraryPlace('modules/documents/user?folder=abc')).toEqual({
      kind: 'folders',
    });
    expect(parseUserLibraryPlace('modules/documents/user')).toEqual({ kind: 'folders' });
  });
});
