import { describe, expect, it } from 'vitest';

import { pillLetter } from '@/components/pill-mark';

describe('pill mark', () => {
  it('prints the first letter or digit of the name, in capitals', () => {
    expect(pillLetter('сертралин')).toBe('С');
    expect(pillLetter('«Эсциталопрам»')).toBe('Э');
    expect(pillLetter('5-НТР')).toBe('5');
    expect(pillLetter('')).toBe('•');
  });
});
