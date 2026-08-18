import { describe, expect, it } from 'vitest';

import { nextLockedInsetFloor } from '@/app/lock-native-safe-bottom';

describe('nextLockedInsetFloor', () => {
  it('raises the floor and ignores a later drop to zero', () => {
    const raised = nextLockedInsetFloor(0, 24);
    expect(raised).toBe(24);
    expect(nextLockedInsetFloor(raised, 0)).toBe(24);
    expect(nextLockedInsetFloor(raised, 32)).toBe(32);
  });
});
