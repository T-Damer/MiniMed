import { describe, expect, it } from 'vitest';

import { findInUnits } from '@/features/library/document-find';
import {
  pdfFindHighlights,
  pdfPageFindUnits,
  pdfPageIndexFromUnitId,
  pdfPageUnitId,
} from './pdf-find-state';
import { buildPdfPageText } from './pdf-page-text';

describe('PDF find state', () => {
  const texts = new Map([
    [0, buildPdfPageText([{ str: 'Артериальная ', hasEOL: false }, { str: 'гипертензия' }])],
    [1, buildPdfPageText([])],
    [2, buildPdfPageText([{ str: 'Лечение: гипертензия, ' }, { str: 'ГИПЕРТЕНЗИЯ у детей' }])],
  ]);

  it('makes one unit per page that has text', () => {
    const units = pdfPageFindUnits(texts);
    expect(units.map((unit) => unit.id)).toEqual([pdfPageUnitId(0), pdfPageUnitId(2)]);
    expect(pdfPageIndexFromUnitId(pdfPageUnitId(7))).toBe(7);
    expect(pdfPageIndexFromUnitId('user-doc-1:3')).toBeUndefined();
    expect(pdfPageIndexFromUnitId('pdf-page-x')).toBeUndefined();
  });

  it('finds a phrase that spans two text items and ignores case', () => {
    const units = pdfPageFindUnits(texts);
    const matches = findInUnits(units, 'артериальная гипертензия', 'exact');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.unitId).toBe(pdfPageUnitId(0));
    expect(findInUnits(units, 'гипертензия', 'exact')).toHaveLength(3);
  });

  it('groups matches by page and marks the active one', () => {
    const matches = findInUnits(pdfPageFindUnits(texts), 'гипертензия', 'exact');
    const highlights = pdfFindHighlights(matches, 2);
    expect(highlights.pageCount).toBe(2);
    expect(highlights.activePage).toBe(2);
    expect(highlights.byPage.get(0)).toEqual([{ start: 13, end: 24, active: false }]);
    expect(highlights.byPage.get(2)?.map((range) => range.active)).toEqual([false, true]);
  });

  it('ignores matches of other kinds of units', () => {
    const highlights = pdfFindHighlights([{ unitId: 'title', start: 0, end: 3 }], 0);
    expect(highlights.pageCount).toBe(0);
    expect(highlights.activePage).toBeUndefined();
  });
});
