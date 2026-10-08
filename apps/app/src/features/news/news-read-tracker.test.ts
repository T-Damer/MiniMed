import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReadTracker, hasPassedTop } from '@/features/news/news-read-tracker';

describe('createReadTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches the items scrolled past into one write per window', () => {
    const commit = vi.fn();
    const tracker = createReadTracker(commit, 500);
    tracker.track('a');
    tracker.track('b');
    vi.advanceTimersByTime(200);
    tracker.track('a');
    tracker.track('c');
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('keeps writing during a scroll that never pauses', () => {
    const commit = vi.fn();
    const tracker = createReadTracker(commit, 500);
    for (let step = 0; step < 20; step += 1) {
      tracker.track(`i${step}`);
      vi.advanceTimersByTime(100);
    }
    expect(commit.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('flushes what is pending on dispose and writes nothing when empty', () => {
    const commit = vi.fn();
    const tracker = createReadTracker(commit, 500);
    tracker.flush();
    expect(commit).not.toHaveBeenCalled();
    tracker.track('x');
    tracker.dispose();
    expect(commit).toHaveBeenCalledWith(['x']);
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('hasPassedTop', () => {
  const view = { top: 0 };
  it('is true only for an element that left through the top of the viewport', () => {
    expect(
      hasPassedTop({
        isIntersecting: false,
        rootBounds: view,
        boundingClientRect: { bottom: -4, height: 80 },
      }),
    ).toBe(true);
    // Below the fold: not read yet.
    expect(
      hasPassedTop({
        isIntersecting: false,
        rootBounds: view,
        boundingClientRect: { bottom: 1200, height: 80 },
      }),
    ).toBe(false);
    // Still on screen.
    expect(
      hasPassedTop({
        isIntersecting: true,
        rootBounds: view,
        boundingClientRect: { bottom: 10, height: 80 },
      }),
    ).toBe(false);
    // A hidden tab reports an empty box and no root.
    expect(
      hasPassedTop({
        isIntersecting: false,
        rootBounds: null,
        boundingClientRect: { bottom: 0, height: 0 },
      }),
    ).toBe(false);
    expect(
      hasPassedTop({
        isIntersecting: false,
        rootBounds: view,
        boundingClientRect: { bottom: 0, height: 0 },
      }),
    ).toBe(false);
  });
});
