import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backOneLayer, navigateBack, pushRoute, replaceRoute, visitRoute } from '@/state/app-back';
import {
  installHistoryEntryTracking,
  readHistoryEntry,
  resetHistoryEntryTrackingForTests,
} from '@/state/history-entries';
import { openHistoryLayer, resetHistoryLayersForTests } from '@/state/history-layer';
import { type FakeBrowser, installFakeBrowser } from '@/state/history-test-double';

let browser: FakeBrowser;
let stopTracking: () => void;

/** A link: the hash is assigned, the events run, the tracker stamps the new entry. */
async function link(hash: string): Promise<void> {
  window.location.hash = hash;
  await browser.settle();
}

const here = (): string => browser.hashes()[browser.cursor()] ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  browser = installFakeBrowser({ hash: '#/search', search: '' });
  stopTracking = installHistoryEntryTracking();
});

afterEach(() => {
  stopTracking();
  resetHistoryLayersForTests();
  resetHistoryEntryTrackingForTests();
  browser.restore();
  vi.useRealTimers();
});

describe('navigateBack (the in-app ‹)', () => {
  it('steps the history back when an app entry lies below, adding nothing', async () => {
    await link('#/search/section/calculators');
    await link('#/calculators/unit-conversion');
    const entries = browser.entries.length;
    navigateBack('#/calculators');
    await browser.settle();
    expect(here()).toBe('#/search/section/calculators');
    expect(browser.entries).toHaveLength(entries);
  });

  it('pressed twice quickly, still only steps back (never pushes the screen it left)', async () => {
    await link('#/a');
    await link('#/b');
    navigateBack('#/parent');
    navigateBack('#/parent');
    await browser.settle();
    await browser.settle();
    // The second press, made while the first step was on its way, was ignored.
    expect(here()).toBe('#/a');
    expect(browser.entries).toHaveLength(3);
  });

  it('replaces the screen with its parent when nothing of the app is below (a deep link)', async () => {
    // A tab that opened on the tool itself: the entry has no app entry under it.
    replaceRoute('#/calculators/unit-conversion');
    expect(readHistoryEntry(window.history.state)?.depth).toBe(0);
    const entries = browser.entries.length;
    navigateBack('#/search');
    expect(here()).toBe('#/search');
    expect(browser.entries).toHaveLength(entries);
  });
});

describe('closing a dialog and going back at once', () => {
  it('steps over the closed layer and the page in one traversal (no overshoot, no leftover)', async () => {
    await link('#/a');
    await link('#/b');
    const layer = openHistoryLayer({ onPop: vi.fn() });
    // «Удалить?» confirmed: the dialog closes and the screen goes back, in the same task.
    layer.dispose();
    navigateBack('#/parent');
    await vi.runAllTimersAsync();
    await browser.settle();
    await browser.settle();
    // From [search, a, b, layer]: the layer and b are left, a is the page under b.
    expect(here()).toBe('#/a');
  });

  it('a tab step counted from the layer is not followed by a second step back', async () => {
    await link('#/notes');
    await link('#/settings');
    const layer = openHistoryLayer({ onPop: vi.fn() });
    layer.dispose();
    expect(visitRoute('#/search')).toBe('stepped');
    await vi.runAllTimersAsync();
    await browser.settle();
    await browser.settle();
    expect(here()).toBe('#/search');
  });
});

describe('visitRoute (tabs)', () => {
  it('pushes a place the history does not hold yet', async () => {
    pushRoute('#/notes');
    expect(visitRoute('#/settings')).toBe('pushed');
    expect(browser.hashes()).toEqual(['#/search', '#/notes', '#/settings']);
  });

  it('steps back to a place already on the branch instead of stacking it again', async () => {
    await link('#/notes');
    await link('#/settings');
    const entries = browser.entries.length;
    expect(visitRoute('#/search')).toBe('stepped');
    await browser.settle();
    expect(here()).toBe('#/search');
    expect(browser.entries).toHaveLength(entries);
  });

  it('a round trip between two tabs adds one entry, not one per tap', async () => {
    console.log('A', visitRoute('#/settings'), browser.hashes(), browser.cursor());
    console.log('B', visitRoute('#/search'), browser.hashes(), browser.cursor());
    await browser.settle();
    console.log('C', browser.hashes(), browser.cursor());
    console.log('D', visitRoute('#/settings'), browser.hashes(), browser.cursor());
    await browser.settle();
    console.log('E', visitRoute('#/search'), browser.hashes(), browser.cursor());
    await browser.settle();
    expect(browser.entries).toHaveLength(2);
    expect(here()).toBe('#/search');
  });

  it('keeps the query of the place it returns to (a tool keeps its state there)', async () => {
    await link('#/tool');
    window.history.replaceState(window.history.state, '', '?x=1#/tool');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    pushRoute('#/notes', '');
    await browser.settle();
    expect(visitRoute('#/tool', '?x=1')).toBe('stepped');
  });

  it('replaces instead of pushing when asked and the place is new (a tab re-tap)', () => {
    const entries = browser.entries.length;
    expect(visitRoute('#/notes', '', 'replace')).toBe('replaced');
    expect(browser.entries).toHaveLength(entries);
    expect(here()).toBe('#/notes');
  });
});

describe('backOneLayer (Android hardware back)', () => {
  const targets = { parentHash: '#/notes', homeHash: '#/search' } as const;

  it('closes a layer before anything else', async () => {
    const onPop = vi.fn();
    openHistoryLayer({ onPop });
    await link('#/ignored-by-this-test');
    // The navigation closed the layer already; open another over the new page.
    const second = vi.fn();
    openHistoryLayer({ onPop: second });
    expect(backOneLayer(targets)).toBe('layer');
    await browser.settle();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('steps the history back when an app entry lies below', async () => {
    await link('#/a');
    expect(backOneLayer(targets)).toBe('history');
    await browser.settle();
    expect(here()).toBe('#/search');
  });

  it('goes to the parent, then the home tab, and exits only from the home tab', () => {
    expect(backOneLayer(targets)).toBe('parent');
    expect(here()).toBe('#/notes');
    expect(backOneLayer({ parentHash: null, homeHash: '#/search' })).toBe('home');
    expect(here()).toBe('#/search');
    expect(backOneLayer({ parentHash: null, homeHash: null })).toBe('exit');
  });
});
