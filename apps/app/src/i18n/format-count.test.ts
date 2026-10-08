import { describe, expect, it } from 'vitest';

import { formatCount } from '@/i18n/format-count';

describe('formatCount', () => {
  it('groups every number of four digits or more with thin non-breaking spaces', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(9084)).toBe('9 084');
    expect(formatCount(31_806)).toBe('31 806');
    expect(formatCount(1_234_567)).toBe('1 234 567');
  });

  it('keeps the sign and drops a fraction', () => {
    expect(formatCount(-12_345)).toBe('−12 345');
    expect(formatCount(1999.9)).toBe('1 999');
  });
});
