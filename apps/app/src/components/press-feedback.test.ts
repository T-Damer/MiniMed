import { describe, expect, it } from 'vitest';

import { pressScale } from '@/components/press-feedback';

describe('press feedback', () => {
  it('shrinks small controls to 0.96 and wide rows only a little', () => {
    expect(pressScale(44, 44, 390, 844)).toBe(0.96);
    expect(pressScale(150, 48, 390, 844)).toBe(0.96);
    expect(pressScale(360, 66, 390, 844)).toBe(0.98);
  });

  it('leaves big surfaces and empty boxes alone', () => {
    expect(pressScale(360, 500, 390, 844)).toBeNull();
    expect(pressScale(0, 40, 390, 844)).toBeNull();
    expect(pressScale(40, 0, 390, 844)).toBeNull();
  });
});
