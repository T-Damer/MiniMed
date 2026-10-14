import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installHistoryEntryTracking,
  resetHistoryEntryTrackingForTests,
} from '@/state/history-entries';
import { type FakeBrowser, installFakeBrowser } from '@/state/history-test-double';
import {
  installScrollRestoration,
  rememberedScroll,
  restoreScrollWhenSettled,
} from '@/state/scroll-restore';

/** A page whose height grows after a while (results arriving late) and that clamps the scroll. */
function stubPage(initialHeight: number) {
  const page = { scrollY: 0, height: initialHeight, viewport: 800 };
  const scrollListeners = new Set<() => void>();
  const frames: Array<() => void> = [];
  const maxScroll = (): number => Math.max(0, page.height - page.viewport);
  const base = (globalThis as unknown as { window?: Record<string, unknown> }).window ?? {};
  Object.defineProperty(base, 'scrollY', { configurable: true, get: () => page.scrollY });
  Object.assign(base, {
    scrollTo: (options: { top: number }) => {
      page.scrollY = Math.min(options.top, maxScroll());
      for (const listener of scrollListeners) listener();
    },
  });
  const addEventListener = base['addEventListener'] as (
    name: string,
    listener: () => void,
    options?: unknown,
  ) => void;
  const removeEventListener = base['removeEventListener'] as (
    name: string,
    listener: () => void,
  ) => void;
  base['addEventListener'] = (name: string, listener: () => void, options?: unknown) => {
    if (name === 'scroll') scrollListeners.add(listener);
    else addEventListener(name, listener, options);
  };
  base['removeEventListener'] = (name: string, listener: () => void) => {
    if (name === 'scroll') scrollListeners.delete(listener);
    else removeEventListener(name, listener);
  };
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('performance', { now: () => Date.now() });
  const documentStub =
    (globalThis as unknown as { document?: Record<string, unknown> }).document ?? {};
  Object.assign(documentStub, {
    documentElement: {
      get scrollHeight() {
        return page.height;
      },
    },
  });
  vi.stubGlobal('document', documentStub);
  const runFrames = (count: number): void => {
    for (let index = 0; index < count; index += 1) {
      const batch = frames.splice(0);
      for (const frame of batch) frame();
    }
  };
  return { page, runFrames };
}

describe('scroll restoration', () => {
  let browser: FakeBrowser;
  let stopTracking: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    browser = installFakeBrowser({ hash: '#/search', search: '' });
    stopTracking = installHistoryEntryTracking();
  });

  afterEach(() => {
    stopTracking();
    resetHistoryEntryTrackingForTests();
    browser.restore();
    vi.useRealTimers();
  });

  it('keeps putting the page at the place while late content makes it tall enough', () => {
    const { page, runFrames } = stubPage(1000);
    restoreScrollWhenSettled(900);
    runFrames(3);
    // The page is only 200 px scrollable: clamped.
    expect(page.scrollY).toBe(200);
    page.height = 2500;
    runFrames(2);
    expect(page.scrollY).toBe(900);
    // It lets go once the page has been still for a while.
    runFrames(30);
  });

  it('remembers the place of an entry as the user scrolls and restores it on arrival', async () => {
    const { page, runFrames } = stubPage(3000);
    const stop = installScrollRestoration();
    window.scrollTo({ top: 700 });
    runFrames(1);
    const firstId = window.history.state
      ? (window.history.state as { minimedEntry: { id: string } }).minimedEntry.id
      : '';
    expect(rememberedScroll(firstId)).toBe(700);

    window.location.hash = '#/calculators/x';
    await browser.settle();
    window.scrollTo({ top: 0 });
    runFrames(1);
    window.history.back();
    await browser.settle();
    runFrames(3);
    expect(page.scrollY).toBe(700);
    stop();
  });
});
