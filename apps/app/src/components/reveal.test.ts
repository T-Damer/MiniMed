import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { revealElement } from '@/components/reveal';

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

let observers: { callback: Callback; disconnected: boolean }[] = [];
let reduced = false;

class FakeObserver {
  readonly record: { callback: Callback; disconnected: boolean };
  constructor(callback: Callback) {
    this.record = { callback, disconnected: false };
    observers.push(this.record);
  }
  observe(): void {}
  disconnect(): void {
    this.record.disconnected = true;
  }
}

function fakeElement() {
  const classes = new Set<string>();
  return {
    offsetWidth: 0,
    scrolled: [] as ScrollIntoViewOptions[],
    classes,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    scrollIntoView(options: ScrollIntoViewOptions) {
      this.scrolled.push(options);
    },
    addEventListener: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  reduced = false;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('window', {
    innerHeight: 800,
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
    matchMedia: () => ({ matches: reduced }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('revealElement', () => {
  it('scrolls smoothly and waits for the element to arrive before the highlight', () => {
    const element = fakeElement();
    revealElement(element as unknown as Element);
    expect(element.scrolled).toEqual([{ block: 'center', behavior: 'smooth' }]);
    expect(element.classes.has('reveal-highlight')).toBe(false);

    observers[0]?.callback([
      {
        isIntersecting: true,
        intersectionRatio: 0.3,
        intersectionRect: { height: 100 } as DOMRect,
      },
    ]);
    expect(element.classes.has('reveal-highlight')).toBe(false);

    observers[0]?.callback([
      {
        isIntersecting: true,
        intersectionRatio: 0.7,
        intersectionRect: { height: 100 } as DOMRect,
      },
    ]);
    expect(element.classes.has('reveal-highlight')).toBe(true);
    expect(observers[0]?.disconnected).toBe(true);
  });

  it('counts an element taller than the screen as arrived once most of the screen shows it', () => {
    const element = fakeElement();
    revealElement(element as unknown as Element);
    observers[0]?.callback([
      {
        isIntersecting: true,
        intersectionRatio: 0.2,
        intersectionRect: { height: 700 } as DOMRect,
      },
    ]);
    expect(element.classes.has('reveal-highlight')).toBe(true);
  });

  it('highlights after the timeout when the element never reaches the threshold', () => {
    const element = fakeElement();
    revealElement(element as unknown as Element);
    vi.advanceTimersByTime(1199);
    expect(element.classes.has('reveal-highlight')).toBe(false);
    vi.advanceTimersByTime(2);
    expect(element.classes.has('reveal-highlight')).toBe(true);
    // The class is removed again when the pulse is over.
    vi.advanceTimersByTime(1300);
    expect(element.classes.has('reveal-highlight')).toBe(false);
  });

  it('cancels the pending highlight', () => {
    const element = fakeElement();
    const cancel = revealElement(element as unknown as Element);
    cancel();
    vi.advanceTimersByTime(5000);
    expect(element.classes.has('reveal-highlight')).toBe(false);
    expect(observers[0]?.disconnected).toBe(true);
  });

  it('only jumps, with no highlight, when motion is reduced', () => {
    reduced = true;
    const element = fakeElement();
    revealElement(element as unknown as Element, { block: 'start' });
    vi.advanceTimersByTime(5000);
    expect(element.scrolled).toEqual([{ block: 'start', behavior: 'auto' }]);
    expect(element.classes.has('reveal-highlight')).toBe(false);
    expect(observers).toHaveLength(0);
  });

  it('can scroll without highlighting', () => {
    const element = fakeElement();
    revealElement(element as unknown as Element, { highlight: false });
    vi.advanceTimersByTime(5000);
    expect(element.classes.has('reveal-highlight')).toBe(false);
  });
});
