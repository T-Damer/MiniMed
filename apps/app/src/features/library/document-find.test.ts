import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_FIND_DISMISS_EVENT,
  dismissOpenDocumentFind,
  exactQueryRanges,
  findInUnits,
  findRangesInText,
  fuzzyQueryRanges,
  rangesForFindUnit,
  stepDocumentFindIndex,
} from '@/features/library/document-find';

describe('document-find exact mode', () => {
  it('matches case-insensitively and normalizes yo', () => {
    expect(findRangesInText('Гипертония у взрослых', 'гипертония', 'exact')).toEqual([
      { start: 0, end: 10 },
    ]);
    expect(findRangesInText('Ёлка', 'елка', 'exact')).toEqual([{ start: 0, end: 4 }]);
  });

  it('does not match a fuzzy-only misspelling', () => {
    expect(exactQueryRanges('Пневмония у детей', 'пневномия')).toEqual([]);
    expect(fuzzyQueryRanges('Пневмония у детей', 'пневномия').length).toBeGreaterThan(0);
  });

  it('does not match an inflected word', () => {
    expect(exactQueryRanges('К I группе относят детей', 'группа')).toEqual([]);
  });
});

describe('document-find similar mode', () => {
  it('finds inflected and close tokens', () => {
    expect(findRangesInText('Пневмония у детей', 'пневномия', 'similar').length).toBeGreaterThan(0);
    expect(findRangesInText('Гипертоническая болезнь', 'гиперт', 'similar').length).toBeGreaterThan(
      0,
    );
  });
});

describe('findInUnits', () => {
  it('returns matches across units in document order', () => {
    const matches = findInUnits(
      [
        { id: 'a', text: 'альфа бета' },
        { id: 'b', text: 'бета гамма' },
      ],
      'бета',
      'exact',
    );
    expect(matches).toEqual([
      { unitId: 'a', start: 6, end: 10 },
      { unitId: 'b', start: 0, end: 4 },
    ]);
  });

  it('returns no matches for an empty query', () => {
    expect(findInUnits([{ id: 'a', text: 'текст' }], '   ', 'exact')).toEqual([]);
  });
});

describe('stepDocumentFindIndex', () => {
  it('wraps forward and backward', () => {
    expect(stepDocumentFindIndex(2, 5, 1)).toBe(3);
    expect(stepDocumentFindIndex(4, 5, 1)).toBe(0);
    expect(stepDocumentFindIndex(0, 5, -1)).toBe(4);
  });

  it('returns 0 when there are no matches', () => {
    expect(stepDocumentFindIndex(3, 0, 1)).toBe(0);
  });
});

describe('rangesForFindUnit', () => {
  it('returns an empty list for unmatched units so highlighting does not re-run fuzzy search', () => {
    const ranges = new Map<string, readonly { start: number; end: number }[]>([
      ['hit', [{ start: 0, end: 4 }]],
    ]);
    expect(rangesForFindUnit(ranges, 'hit', 'бета')).toEqual([{ start: 0, end: 4 }]);
    expect(rangesForFindUnit(ranges, 'miss', 'бета')).toEqual([]);
    expect(rangesForFindUnit(ranges, 'hit', '   ')).toBeUndefined();
  });
});

describe('dismissOpenDocumentFind', () => {
  it('dispatches dismiss on the open find root', () => {
    let dismissed = false;
    const open = {
      dispatchEvent: (event: Event) => {
        dismissed = event.type === DOCUMENT_FIND_DISMISS_EVENT;
        return true;
      },
    };
    const root = {
      querySelector: (selector: string) => (selector === '.document-find--open' ? open : null),
    } as unknown as ParentNode;
    expect(dismissOpenDocumentFind(root)).toBe(true);
    expect(dismissed).toBe(true);
  });

  it('returns false when find is closed', () => {
    const root = {
      querySelector: () => null,
    } as unknown as ParentNode;
    expect(dismissOpenDocumentFind(root)).toBe(false);
  });
});
