import { describe, expect, it } from 'vitest';

import { featureOfDayIndex } from './feature-of-day';

describe('featureOfDayIndex', () => {
  it('keeps one capability for the whole local day and moves on the next day', () => {
    const morning = featureOfDayIndex(4, new Date(2026, 8, 28, 6, 0));
    const night = featureOfDayIndex(4, new Date(2026, 8, 28, 23, 59));
    const tomorrow = featureOfDayIndex(4, new Date(2026, 8, 29, 6, 0));
    expect(night).toBe(morning);
    expect(tomorrow).toBe((morning + 1) % 4);
  });

  it('stays in range and handles an empty list', () => {
    for (let day = 1; day <= 10; day += 1) {
      const index = featureOfDayIndex(3, new Date(2026, 0, day));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(3);
    }
    expect(featureOfDayIndex(0, new Date())).toBe(0);
  });
});
