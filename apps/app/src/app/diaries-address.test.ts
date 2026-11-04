import { describe, expect, it } from 'vitest';

import { diariesAddress } from '@/app/diaries-address';

describe('the diaries copy starts on the sign-in alone (DIARY24)', () => {
  it('for the diaries and the bare page, not for the other tabs', () => {
    for (const hash of ['', '#', '#/', '#/notes/diaries', '#/notes/diaries/p1/charts']) {
      expect(diariesAddress(hash)).toBe(true);
    }
    for (const hash of ['#/settings', '#/assessments/mine', '#/notes']) {
      expect(diariesAddress(hash)).toBe(false);
    }
  });
});
