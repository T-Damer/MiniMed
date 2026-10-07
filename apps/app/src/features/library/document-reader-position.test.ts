import { describe, expect, it } from 'vitest';

import {
  parseReaderPage,
  readerPosition,
  readerPositionAnchor,
  readerPositionAriaLabel,
  readerPositionLabel,
} from '@/features/library/document-reader-position';

const anchors = ['a', 'b', 'c', 'd'];

describe('readerPosition', () => {
  it('numbers the active section by its place in the contents list', () => {
    expect(readerPosition(anchors, 'c')).toEqual({ current: 3, total: 4 });
  });

  it('starts at the first section before any is active or when the anchor is unknown', () => {
    expect(readerPosition(anchors, '')).toEqual({ current: 1, total: 4 });
    expect(readerPosition(anchors, 'elsewhere')).toEqual({ current: 1, total: 4 });
  });

  it('shows no counter for a document with fewer than two sections', () => {
    expect(readerPosition([], '')).toBeNull();
    expect(readerPosition(['only'], 'only')).toBeNull();
  });
});

describe('labels', () => {
  it('prints «current / total» and a spoken label', () => {
    const position = { current: 12, total: 48 };
    expect(readerPositionLabel(position)).toBe('12 / 48');
    expect(readerPositionAriaLabel(position)).toBe('Раздел 12 из 48. Перейти к разделу');
  });
});

describe('parseReaderPage', () => {
  it('reads a number and clamps it to the document', () => {
    expect(parseReaderPage('7', 48)).toBe(7);
    expect(parseReaderPage(' 12 ', 48)).toBe(12);
    expect(parseReaderPage('0', 48)).toBe(1);
    expect(parseReaderPage('999', 48)).toBe(48);
  });

  it('rejects anything that is not a whole number', () => {
    expect(parseReaderPage('', 48)).toBeNull();
    expect(parseReaderPage('1.5', 48)).toBeNull();
    expect(parseReaderPage('-3', 48)).toBeNull();
    expect(parseReaderPage('двенадцать', 48)).toBeNull();
    expect(parseReaderPage('5', 0)).toBeNull();
  });
});

describe('readerPositionAnchor', () => {
  it('maps a page number back to its section anchor', () => {
    expect(readerPositionAnchor(anchors, 1)).toBe('a');
    expect(readerPositionAnchor(anchors, 4)).toBe('d');
    expect(readerPositionAnchor(anchors, 5)).toBeUndefined();
  });
});
