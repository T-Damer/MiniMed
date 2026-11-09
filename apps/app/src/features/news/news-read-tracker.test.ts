import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPassedObserver,
  createReadTracker,
  hasPassedTop,
  isAboveTop,
} from '@/features/news/news-read-tracker';

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

describe('createPassedObserver', () => {
  type Callback = (entries: readonly Partial<IntersectionObserverEntry>[]) => void;
  let fire: Callback = () => undefined;
  const watched = new Set<Element>();
  beforeEach(() => {
    watched.clear();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: Callback) {
          fire = callback;
        }
        observe(element: Element) {
          watched.add(element);
        }
        unobserve(element: Element) {
          watched.delete(element);
        }
        disconnect() {
          watched.clear();
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function row(box: { bottom: number; height: number }): Element {
    return {
      isConnected: true,
      getBoundingClientRect: () => box,
    } as unknown as Element;
  }

  it('reports the rows a jump moved from below the screen to above it, which fire nothing', () => {
    const passed: string[] = [];
    const observer = createPassedObserver((id) => passed.push(id));
    const onScreen = { bottom: 300, height: 80 };
    const below = { bottom: 2000, height: 80 };
    const first = row(onScreen);
    const jumped = row(below);
    const stillBelow = row({ bottom: 9000, height: 80 });
    observer.observe(first, 'first');
    observer.observe(jumped, 'jumped');
    observer.observe(stillBelow, 'below');
    // A 5000 px jump: the row that was on screen fires; the jumped one changed no intersection.
    onScreen.bottom = -4700;
    below.bottom = -3000;
    fire([
      {
        target: first,
        isIntersecting: false,
        rootBounds: { top: 0 } as DOMRectReadOnly,
        boundingClientRect: { bottom: -4700, height: 80 } as DOMRectReadOnly,
      },
    ]);
    expect(passed).toEqual(['first', 'jumped']);
    expect(watched.has(jumped)).toBe(false);
    expect(watched.has(stillBelow)).toBe(true);
  });

  it('takes no hidden row for a passed one', () => {
    expect(isAboveTop({ bottom: 0, height: 0 }, 0)).toBe(false);
    expect(isAboveTop({ bottom: -1, height: 40 }, 0)).toBe(true);
  });
});
