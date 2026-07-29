import { describe, expect, it } from 'vitest';

import { hapticPattern } from '@/state/haptics';

describe('hapticPattern', () => {
  it('keeps three visibly distinct feedback levels', () => {
    expect(hapticPattern('light')).toBe(8);
    expect(hapticPattern('medium')).toEqual([12, 8, 12]);
    expect(hapticPattern('heavy')).toEqual([24, 12, 32]);
  });
});
