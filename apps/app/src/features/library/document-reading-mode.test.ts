import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOCUMENT_TEXT_SCALE,
  DOCUMENT_TEXT_SCALE_LEVELS,
  normalizeDocumentTextScale,
  stepDocumentTextScale,
} from './document-reading-mode';

describe('document reading text scale', () => {
  it('keeps a small bounded set of readable scale levels', () => {
    expect(DOCUMENT_TEXT_SCALE_LEVELS).toEqual([90, 100, 110, 125, 140]);
    expect(DEFAULT_DOCUMENT_TEXT_SCALE).toBe(100);
  });

  it('normalizes arbitrary stored values to the nearest supported level', () => {
    expect(normalizeDocumentTextScale(89)).toBe(90);
    expect(normalizeDocumentTextScale(104)).toBe(100);
    expect(normalizeDocumentTextScale(118)).toBe(125);
    expect(normalizeDocumentTextScale(999)).toBe(140);
    expect(normalizeDocumentTextScale(Number.NaN)).toBe(100);
  });

  it('steps without leaving the supported bounds', () => {
    expect(stepDocumentTextScale(100, -1)).toBe(90);
    expect(stepDocumentTextScale(100, 1)).toBe(110);
    expect(stepDocumentTextScale(90, -1)).toBe(90);
    expect(stepDocumentTextScale(140, 1)).toBe(140);
    expect(stepDocumentTextScale(119, 1)).toBe(140);
  });
});
