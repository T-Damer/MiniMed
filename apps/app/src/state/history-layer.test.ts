import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installHistoryEntryTracking,
  readHistoryEntry,
  resetHistoryEntryTrackingForTests,
} from '@/state/history-entries';
import {
  hasHistoryLayer,
  openHistoryLayer,
  popTopHistoryLayer,
  resetHistoryLayersForTests,
} from '@/state/history-layer';
import { type FakeBrowser, installFakeBrowser } from '@/state/history-test-double';

let browser: FakeBrowser;
let stopTracking: () => void;

/** Navigates the way a link does: assigns the hash, then lets the events run. */
async function navigate(hash: string): Promise<void> {
  window.location.hash = hash;
  await browser.settle();
}

async function back(): Promise<void> {
  window.history.back();
  await browser.settle();
}

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

describe('history layers', () => {
  it('pushes one stamped entry at the same address and closes when the history steps back', async () => {
    const onPop = vi.fn();
    openHistoryLayer({ onPop });
    expect(browser.entries).toHaveLength(2);
    expect(browser.hashes()).toEqual(['#/search', '#/search']);
    expect(readHistoryEntry(window.history.state)).toMatchObject({ depth: 1, layer: true });
    expect(hasHistoryLayer()).toBe(true);

    await back();
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(hasHistoryLayer()).toBe(false);
    expect(browser.cursor()).toBe(0);
  });

  it('closes from the UI by stepping back, and the arrival closes the component once', async () => {
    const onPop = vi.fn();
    const layer = openHistoryLayer({ onPop });
    layer.pop();
    await browser.settle();
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(browser.cursor()).toBe(0);
    // The component's cleanup afterwards has nothing left to take off.
    layer.dispose();
    await vi.runAllTimersAsync();
    await browser.settle();
    expect(browser.cursor()).toBe(0);
  });

  it('takes its entry off when the component closes itself (Escape, a tap outside)', async () => {
    const layer = openHistoryLayer({ onPop: vi.fn() });
    layer.dispose();
    await vi.runAllTimersAsync();
    await browser.settle();
    expect(browser.cursor()).toBe(0);
    expect(hasHistoryLayer()).toBe(false);
  });

  it('peels stacked layers one per step, top first', async () => {
    const order: string[] = [];
    openHistoryLayer({ onPop: () => order.push('sheet') });
    openHistoryLayer({ onPop: () => order.push('preview') });
    expect(browser.cursor()).toBe(2);
    await back();
    expect(order).toEqual(['preview']);
    await back();
    expect(order).toEqual(['preview', 'sheet']);
    expect(browser.cursor()).toBe(0);
  });

  it('a navigation made from a layer closes it and leaves a dead entry that one back steps over', async () => {
    const onPop = vi.fn();
    openHistoryLayer({ onPop });
    await navigate('#/calculators/x');
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(browser.hashes()).toEqual(['#/search', '#/search', '#/calculators/x']);

    // One back from the new page lands on the page under the layer, not on a phantom copy of it.
    await back();
    await browser.settle();
    expect(browser.cursor()).toBe(0);
    expect(browser.entries).toHaveLength(3);
  });

  it('a component that closes and then navigates does not race its own step back', async () => {
    const layer = openHistoryLayer({ onPop: vi.fn() });
    layer.dispose();
    // The navigation follows in the same task, before the deferred step back would run.
    window.location.hash = '#/atc/A01';
    await vi.runAllTimersAsync();
    await browser.settle();
    expect(browser.hashes()).toEqual(['#/search', '#/search', '#/atc/A01']);
    expect(browser.cursor()).toBe(2);
    await back();
    await browser.settle();
    expect(browser.cursor()).toBe(0);
  });

  it('steps over a dead layer going forward as well', async () => {
    openHistoryLayer({ onPop: vi.fn() });
    await navigate('#/a');
    await back();
    await browser.settle();
    expect(browser.cursor()).toBe(0);
    window.history.forward();
    await browser.settle();
    await browser.settle();
    // Forward from the page lands past the dead layer, on the page that was left.
    expect(browser.hashes()[browser.cursor()]).toBe('#/a');
  });

  it('popTopHistoryLayer is the hardware back: it closes the topmost layer and reports it', async () => {
    const onPop = vi.fn();
    expect(popTopHistoryLayer()).toBe(false);
    openHistoryLayer({ onPop });
    expect(popTopHistoryLayer()).toBe(true);
    await browser.settle();
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(popTopHistoryLayer()).toBe(false);
  });

  it('a layer opened while a step back is still on its way waits for it', async () => {
    const first = openHistoryLayer({ onPop: vi.fn() });
    first.pop();
    const onPop = vi.fn();
    openHistoryLayer({ onPop });
    await browser.settle();
    await browser.settle();
    // The step back took the first layer; the second one is open on top of the page.
    expect(browser.cursor()).toBe(1);
    expect(readHistoryEntry(window.history.state)?.layer).toBe(true);
    await back();
    expect(onPop).toHaveBeenCalledTimes(1);
  });
});
