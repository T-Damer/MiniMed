import { describe, expect, it } from 'vitest';

import {
  highlightStatusCounts,
  highlightStatusNote,
  isPaintedHighlight,
} from '@/features/library/highlight-status';

const CARRIED = { documentId: 'kr.rf.507_3', highlightId: 'hl-1', rootId: 'hl-1' };

describe('highlightStatusNote', () => {
  it('says nothing for a highlight that is where it was selected', () => {
    expect(highlightStatusNote({})).toBeUndefined();
    expect(highlightStatusNote({ anchorStatus: 'exact' })).toBeUndefined();
  });

  it('names the origin and the uncertainty of a carried highlight', () => {
    expect(highlightStatusNote({ anchorStatus: 'exact', carriedFrom: CARRIED })).toBe(
      'Из прежней редакции',
    );
    expect(highlightStatusNote({ anchorStatus: 'moved', carriedFrom: CARRIED })).toContain(
      'перенесён',
    );
    expect(highlightStatusNote({ anchorStatus: 'approximate', carriedFrom: CARRIED })).toContain(
      'приблизительно',
    );
    expect(highlightStatusNote({ anchorStatus: 'approximate' })).toContain('приблизительно');
  });

  it('says a missing highlight was not found in the new edition', () => {
    expect(highlightStatusNote({ anchorStatus: 'missing', carriedFrom: CARRIED })).toBe(
      'Не найдено в новой редакции',
    );
  });
});

describe('painted highlights and counts', () => {
  it('paints everything but the missing ones', () => {
    expect(isPaintedHighlight({ anchorStatus: 'missing' })).toBe(false);
    expect(isPaintedHighlight({ anchorStatus: 'approximate' })).toBe(true);
    expect(isPaintedHighlight({})).toBe(true);
  });

  it('counts the ones that need attention', () => {
    expect(
      highlightStatusCounts([
        { anchorStatus: 'exact' },
        { anchorStatus: 'missing' },
        { anchorStatus: 'approximate' },
        {},
      ]),
    ).toEqual({ total: 4, missing: 1, approximate: 1 });
  });
});
