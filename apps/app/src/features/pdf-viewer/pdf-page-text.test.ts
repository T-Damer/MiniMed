import { describe, expect, it } from 'vitest';

import { buildPdfPageText, pdfPageHasText, pdfTextSegments } from './pdf-page-text';

describe('PDF page text', () => {
  const page = buildPdfPageText([
    { str: 'Артериальная ', hasEOL: false },
    { str: 'гипертензия', hasEOL: true },
    { type: 'beginMarkedContent' } as never,
    { str: 'у взрослых' },
  ]);

  it('joins items, turns a line end into a space and skips markers', () => {
    expect(page.text).toBe('Артериальная гипертензия у взрослых');
    expect(page.itemStarts).toEqual([0, 13, 25]);
    expect(page.itemLengths).toEqual([13, 11, 10]);
  });

  it('maps a range back to the item pieces that carry it', () => {
    const start = page.text.indexOf('гипертензия у');
    expect(pdfTextSegments(page, start, start + 'гипертензия у'.length)).toEqual([
      { itemIndex: 1, from: 0, to: 11 },
      { itemIndex: 2, from: 0, to: 1 },
    ]);
    expect(pdfTextSegments(page, 3, 8)).toEqual([{ itemIndex: 0, from: 3, to: 8 }]);
  });

  it('gives no segments for an empty range or an offset inside a line separator', () => {
    expect(pdfTextSegments(page, 4, 4)).toEqual([]);
    expect(pdfTextSegments(page, 24, 25)).toEqual([]);
  });

  it('knows an image-only page has no text', () => {
    expect(pdfPageHasText(buildPdfPageText([]))).toBe(false);
    expect(pdfPageHasText(buildPdfPageText([{ str: '  ' }]))).toBe(false);
    expect(pdfPageHasText(page)).toBe(true);
  });
});
