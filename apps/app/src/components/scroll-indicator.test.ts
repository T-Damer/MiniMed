import { describe, expect, it } from 'vitest';

import {
  computeScrollIndicatorThumb,
  SCROLL_INDICATOR_RESIZE_MS,
} from '@/components/scroll-indicator-layout';

describe('computeScrollIndicatorThumb', () => {
  it('hides the thumb when content fits or track has no room', () => {
    expect(computeScrollIndicatorThumb({ visible: 800, total: 800, room: 780 }, 0)).toEqual({
      shown: false,
      size: 0,
      top: 0,
    });
    expect(computeScrollIndicatorThumb({ visible: 800, total: 801, room: 780 }, 0)).toEqual({
      shown: false,
      size: 0,
      top: 0,
    });
    expect(computeScrollIndicatorThumb({ visible: 800, total: 2400, room: 0 }, 400)).toEqual({
      shown: false,
      size: 0,
      top: 0,
    });
  });

  it('sizes proportionally with a 24px minimum and clamps scroll offset to the track bounds', () => {
    const normal = computeScrollIndicatorThumb({ visible: 500, total: 2000, room: 400 }, 750);
    expect(normal.shown).toBe(true);
    expect(normal.size).toBe(100);
    expect(normal.top).toBe(150);

    const veryLong = computeScrollIndicatorThumb(
      { visible: 400, total: 50_000, room: 400 },
      60_000,
    );
    expect(veryLong.shown).toBe(true);
    expect(veryLong.size).toBe(24);
    expect(veryLong.top).toBe(376);

    const negativeScroll = computeScrollIndicatorThumb(
      { visible: 400, total: 1600, room: 400 },
      -40,
    );
    expect(negativeScroll.top).toBe(0);
    expect(SCROLL_INDICATOR_RESIZE_MS).toBeGreaterThanOrEqual(50);
  });
});
