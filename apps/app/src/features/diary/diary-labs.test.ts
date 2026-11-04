import { describe, expect, it } from 'vitest';

import { labSuggestions } from '@/features/diary/diary-labs';

describe('lab suggestions', () => {
  it('puts the tests a medicine calls for first, with the reason in words', () => {
    const [first, ...rest] = labSuggestions(['рисперидон', 'Сертралин'], []);
    expect(first?.preset.name).toBe('Пролактин');
    expect(first?.why).toBe('Рисперидон может повышать пролактин');
    expect(rest.every((one) => one.why === undefined)).toBe(true);
  });

  it('knows trade names and leaves out what is already asked for', () => {
    const names = labSuggestions(['Седалит'], ['литий в крови']).map((one) => one.preset.name);
    expect(names.slice(0, 2)).toEqual(['ТТГ', 'Креатинин']);
    expect(names).not.toContain('Литий в крови');
  });
});
