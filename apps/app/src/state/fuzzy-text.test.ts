import { describe, expect, it } from 'vitest';

import { matchesFuzzyQuery } from './fuzzy-text';

describe('matchesFuzzyQuery', () => {
  it('matches an empty query', () => {
    expect(matchesFuzzyQuery('', ['Ядро'])).toBe(true);
  });

  it('matches a substring regardless of yo', () => {
    expect(matchesFuzzyQuery('ядро', ['Встроенное Ядро'])).toBe(true);
    expect(matchesFuzzyQuery('пневмон', ['Пневмония'])).toBe(true);
  });

  it('allows a one-edit misspelling on a long token', () => {
    expect(matchesFuzzyQuery('пневномия', ['Пневмония у детей'])).toBe(true);
  });

  it('does not fuzzy-expand a short abbreviation', () => {
    expect(matchesFuzzyQuery('ОАК', ['ОАЭ документ'])).toBe(false);
  });
});
