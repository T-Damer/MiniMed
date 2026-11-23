import { describe, expect, it } from 'vitest';

import {
  combineAndDeduplicatePersonalHits,
  personalHitMatchedInTitle,
} from '@/features/notes/personal-search-matches';
import type { PatientNoteMatch } from '@/state/patient-notes';
import type { UserLibraryMatch } from '@/state/user-library';

describe('personal-search-matches', () => {
  it('deduplicates a note that appears in both patient-notes and its user-library mirror', () => {
    const noteHit = {
      card: { id: 'card-1', title: 'ПТРС', summary: '', createdAt: '', updatedAt: '' },
      note: {
        id: 'note-1',
        cardId: 'card-1',
        title: '',
        text: 'Критерии ПТРС и терапия первой линии',
        createdAt: '',
        updatedAt: '',
      },
      score: 10,
      snippet: 'Критерии ПТРС и терапия первой линии',
    } as unknown as PatientNoteMatch;

    const libraryMirror = {
      document: {
        id: 'lib-1',
        title: 'ПТРС',
        fileName: 'ПТРС.md',
        mimeType: 'text/markdown',
        pageCount: 1,
        source: { kind: 'note', noteId: 'note-1' },
      },
      pageIndex: 0,
      score: 9,
      snippet: 'Критерии ПТРС и терапия первой линии',
    } as unknown as UserLibraryMatch;

    const combined = combineAndDeduplicatePersonalHits([], [noteHit], [libraryMirror]);
    expect(combined).toHaveLength(1);
    expect(combined[0]?.kind).toBe('library');
  });

  it('distinguishes matches in the note name from matches only in the body text', () => {
    expect(personalHitMatchedInTitle('ПТРС', 'ПТРС — протокол')).toBe(true);
    expect(personalHitMatchedInTitle('цефтриаксон', 'Иванов И.')).toBe(false);
  });
});
