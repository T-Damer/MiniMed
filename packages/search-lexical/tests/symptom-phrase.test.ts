import { describe, expect, it } from 'vitest';

import { isSymptomPhraseQuery } from '../src/index';

describe('isSymptomPhraseQuery', () => {
  it('accepts a list of complaints', () => {
    expect(isSymptomPhraseQuery('болит живот рвота')).toBe(true);
    expect(isSymptomPhraseQuery('рвота и понос у ребенка')).toBe(true);
    expect(isSymptomPhraseQuery('Тошнота, рвота')).toBe(true);
  });

  it('rejects one symptom, a disease name and a mixed phrase', () => {
    expect(isSymptomPhraseQuery('кашель')).toBe(false);
    expect(isSymptomPhraseQuery('Депрессия')).toBe(false);
    expect(isSymptomPhraseQuery('пневмония у детей')).toBe(false);
    expect(isSymptomPhraseQuery('рвота гастрит')).toBe(false);
  });
});
