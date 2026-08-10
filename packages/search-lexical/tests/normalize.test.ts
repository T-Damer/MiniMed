import { describe, expect, it } from 'vitest';

import { isCloseToken, levenshteinDistance } from '../src/index';

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
