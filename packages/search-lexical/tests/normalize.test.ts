import { describe, expect, it } from 'vitest';

import {
  isCloseToken,
  levenshteinDistance,
  normalizeIcd10Lookalikes,
  normalizeSurfaceText,
  normalizeSurfaceTextWithOffsets,
} from '../src/index';

describe('ICD-10 lookalike normalization', () => {
  it.each([
    ['А09', 'a09'],
    ['С50', 'c50'],
    ['Е11', 'e11'],
    ['М16.1', 'm16.1'],
  ])('normalizes Cyrillic lookalikes in code-shaped tokens: %s', (value, expected) => {
    expect(normalizeSurfaceText(value)).toBe(expected);
  });

  it('leaves Russian prose and spaced unit values unchanged', () => {
    expect(normalizeSurfaceText('с молоком')).toBe('с молоком');
    expect(normalizeSurfaceText('С 50 мг')).toBe('с 50 мг');
  });

  it('keeps source offsets aligned after replacing a lookalike', () => {
    const normalized = normalizeSurfaceTextWithOffsets('МКБ: А09');

    expect(normalized.text).toBe('мкб: a09');
    expect(normalized.offsets[5]).toEqual({ start: 5, end: 6 });
  });

  it('normalizes lookalikes without changing token length', () => {
    expect(normalizeIcd10Lookalikes('А09 С50 Е11 М16')).toBe('A09 C50 E11 M16');
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('гиперемия', 'гиперемия', 2)).toBe(0);
  });

  it('counts a single substitution', () => {
    expect(levenshteinDistance('гиперемия', 'гипиремия', 2)).toBe(1);
  });

  it('reports the cheap "too far" sentinel once the budget is exceeded', () => {
    expect(levenshteinDistance('кашель', 'пневмония', 2)).toBe(3);
  });
});

describe('isCloseToken', () => {
  it('matches a one-letter typo in a long clinical term', () => {
    expect(isCloseToken('гиперемия', 'гипиремия')).toBe(true);
  });

  it('matches an inflected word form within the edit budget', () => {
    expect(isCloseToken('мочеиспускании', 'мочеиспускание')).toBe(true);
  });

  it('never fuzzy-matches short tokens, even with one edit', () => {
    expect(isCloseToken('боль', 'моль')).toBe(false);
    expect(isCloseToken('оак', 'оам')).toBe(false);
  });

  it('rejects unrelated words of similar length', () => {
    expect(isCloseToken('лихорадка', 'головокружение')).toBe(false);
  });

  it('still requires exact equality below the fuzzy length floor', () => {
    expect(isCloseToken('боль', 'боль')).toBe(true);
    expect(isCloseToken('боль', 'боли')).toBe(false);
  });
});
