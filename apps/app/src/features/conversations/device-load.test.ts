import { describe, expect, it } from 'vitest';

import { busyShare, weakDevice } from './device-load';

describe('device load', () => {
  it('treats a phone with 2 GB or 2 cores as too weak for live text', () => {
    expect(weakDevice({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(true);
    expect(weakDevice({ deviceMemory: 8, hardwareConcurrency: 2 })).toBe(true);
    expect(weakDevice({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
    // A WebView that does not say keeps live text.
    expect(weakDevice({})).toBe(false);
  });

  it('measures the long-task share of the last fifteen seconds only', () => {
    const now = 100_000;
    // A 3 s freeze at start-up, long ago, does not count.
    expect(busyShare([{ start: 10_000, duration: 3_000 }], now)).toBe(0);
    // 6 s of long tasks within the window: 40 %.
    expect(
      busyShare(
        [
          { start: now - 14_000, duration: 3_000 },
          { start: now - 5_000, duration: 3_000 },
        ],
        now,
      ),
    ).toBeCloseTo(0.4, 5);
    // A task that began before the window counts only its part inside it.
    expect(busyShare([{ start: now - 16_000, duration: 2_000 }], now)).toBeCloseTo(1 / 15, 5);
  });
});
