import { describe, expect, it } from 'vitest';

import {
  loadPdfPosition,
  mostVisiblePage,
  PDF_POSITION_KEY,
  PDF_POSITION_LIMIT,
  parsePdfPosition,
  readingPositionFromRects,
  savePdfPosition,
} from './pdf-position';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial ? [[PDF_POSITION_KEY, initial]] : []);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const position = (page: number, savedAt = 1) => ({
  page,
  fraction: 0.25,
  zoom: 1.5,
  fit: 'custom' as const,
  savedAt,
});

describe('PDF reading position', () => {
  it('stores a position per document and reads it back', () => {
    const storage = memoryStorage();
    savePdfPosition('user:a', position(12), storage);
    savePdfPosition('note:b', position(3), storage);
    expect(loadPdfPosition('user:a', storage)?.page).toBe(12);
    expect(loadPdfPosition('note:b', storage)?.page).toBe(3);
    expect(loadPdfPosition('user:none', storage)).toBeUndefined();
  });

  it('keeps only the newest documents', () => {
    const storage = memoryStorage();
    for (let index = 0; index < PDF_POSITION_LIMIT + 5; index += 1) {
      savePdfPosition(`user:${String(index)}`, position(2, index), storage);
    }
    expect(loadPdfPosition('user:0', storage)).toBeUndefined();
    expect(loadPdfPosition(`user:${String(PDF_POSITION_LIMIT + 4)}`, storage)?.page).toBe(2);
  });

  it('survives broken or hostile stored data', () => {
    expect(loadPdfPosition('x', memoryStorage('{not json'))).toBeUndefined();
    expect(loadPdfPosition('x', memoryStorage('[]'))).toBeUndefined();
    expect(parsePdfPosition({ page: 0, fraction: 0, zoom: 1, fit: 'width' })).toBeUndefined();
    expect(parsePdfPosition({ page: 2, fraction: 0, zoom: 1, fit: 'bogus' })).toBeUndefined();
    expect(parsePdfPosition({ page: 2, fraction: 9, zoom: 99, fit: 'width' })).toMatchObject({
      fraction: 1,
      zoom: 8,
    });
  });

  it('works without any storage', () => {
    expect(() => savePdfPosition('x', position(1), undefined)).not.toThrow();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadPdfPosition('x', throwing)).toBeUndefined();
  });

  it('finds the page and offset under the reading line', () => {
    const pages = [
      { top: -900, height: 1000 },
      { top: 100, height: 1000 },
      { top: 1100, height: 1000 },
    ];
    expect(readingPositionFromRects(pages, 0)).toEqual({ page: 1, fraction: 0.9 });
    expect(readingPositionFromRects(pages, 350)).toEqual({ page: 2, fraction: 0.25 });
    expect(readingPositionFromRects([], 0)).toEqual({ page: 1, fraction: 0 });
    // A page whose top sits a pixel under the line (pixel snapping) is the page being read.
    expect(readingPositionFromRects(pages, 99)).toEqual({ page: 2, fraction: 0 });
  });

  it('names the page that fills most of the visible band as the current one', () => {
    const pages = [
      { top: -600, height: 1000 },
      { top: 410, height: 1000 },
      { top: 1420, height: 1000 },
    ];
    // Band 0–800: page 1 shows 400 px, page 2 shows 390 px.
    expect(mostVisiblePage(pages, 0, 800)).toBe(1);
    expect(mostVisiblePage(pages, 100, 800)).toBe(2);
    expect(mostVisiblePage([], 0, 800)).toBe(1);
  });
});
