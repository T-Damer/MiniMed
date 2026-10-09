import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadRecentCalculatorIds,
  RECENT_CALCULATORS_LIMIT,
  rememberRecentCalculator,
} from '@/state/recent-calculators';

describe('recent calculators', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the last few opened, newest first, without repeats', () => {
    expect(loadRecentCalculatorIds()).toEqual([]);
    rememberRecentCalculator('bsa');
    rememberRecentCalculator('egfr');
    rememberRecentCalculator('bsa');
    expect(loadRecentCalculatorIds()).toEqual(['bsa', 'egfr']);
    for (let index = 0; index < RECENT_CALCULATORS_LIMIT + 2; index += 1) {
      rememberRecentCalculator(`tool-${index}`);
    }
    const recent = loadRecentCalculatorIds();
    expect(recent).toHaveLength(RECENT_CALCULATORS_LIMIT);
    expect(recent[0]).toBe(`tool-${RECENT_CALCULATORS_LIMIT + 1}`);
  });

  it('ignores a corrupt store and a store that refuses writes', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{"not":"a list"}',
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(loadRecentCalculatorIds()).toEqual([]);
    expect(rememberRecentCalculator('bsa')).toEqual(['bsa']);
  });
});
