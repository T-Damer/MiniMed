import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyArrival,
  currentHistoryEntry,
  hasInAppPreviousEntry,
  installHistoryEntryTracking,
  placeOf,
  pushStampedEntry,
  readHistoryEntry,
  resetHistoryEntryTrackingForTests,
  stepsBackToPlace,
  withHistoryEntry,
} from '@/state/history-entries';
import { type FakeBrowser, installFakeBrowser } from '@/state/history-test-double';

describe('classifying an unstamped arrival with the Navigation API', () => {
  const previous = { id: 'p', depth: 2 };

  it('a push that cut off forward entries still goes one level deeper (the length does not change)', () => {
    const pushed = classifyArrival({
      state: null,
      length: 5,
      previous,
      previousLength: 5,
      navigation: new Set(['push']),
    });
    expect(pushed?.depth).toBe(3);
  });

  it('a replaced state keeps the place of the entry', () => {
    const replaced = classifyArrival({
      state: null,
      length: 5,
      previous,
      previousLength: 5,
      navigation: new Set(['replace']),
    });
    expect(replaced?.depth).toBe(2);
  });

  it('a push followed by a replace of the same entry is still a push', () => {
    const pushed = classifyArrival({
      state: null,
      length: 6,
      previous,
      previousLength: 5,
      navigation: new Set(['push', 'replace']),
    });
    expect(pushed?.depth).toBe(3);
  });

  it('falls back to the length without the API', () => {
    expect(classifyArrival({ state: null, length: 6, previous, previousLength: 5 })?.depth).toBe(3);
    expect(classifyArrival({ state: null, length: 5, previous, previousLength: 5 })?.depth).toBe(0);
  });
});

describe('places on the branch', () => {
  let browser: FakeBrowser;
  let stop: () => void;

  const link = async (hash: string): Promise<void> => {
    window.location.hash = hash;
    await browser.settle();
  };

  beforeEach(() => {
    browser = installFakeBrowser({ hash: '#/search', search: '' });
    stop = installHistoryEntryTracking();
  });

  afterEach(() => {
    stop();
    resetHistoryEntryTrackingForTests();
    browser.restore();
  });

  it('counts the entries below the page through links and back steps', async () => {
    expect(hasInAppPreviousEntry()).toBe(false);
    await link('#/a');
    await link('#/b');
    expect(currentHistoryEntry().depth).toBe(2);
    window.history.back();
    await browser.settle();
    expect(currentHistoryEntry().depth).toBe(1);
    // A link taken after a back step cuts off the forward entry: still one level deeper.
    await link('#/c');
    expect(currentHistoryEntry().depth).toBe(2);
    expect(hasInAppPreviousEntry()).toBe(true);
  });

  it('finds an earlier visit of an address below the current entry, nearest first', async () => {
    await link('#/a');
    await link('#/b');
    await link('#/a');
    expect(stepsBackToPlace(placeOf('#/b'))).toBe(-1);
    expect(stepsBackToPlace(placeOf('#/a'))).toBe(-2);
    expect(stepsBackToPlace(placeOf('#/search'))).toBe(-3);
    expect(stepsBackToPlace(placeOf('#/never'))).toBeNull();
  });

  it('forgets the places above an entry once a new push replaces them', async () => {
    await link('#/a');
    await link('#/b');
    window.history.go(-2);
    await browser.settle();
    await link('#/c');
    expect(stepsBackToPlace(placeOf('#/b'))).toBeNull();
    expect(stepsBackToPlace(placeOf('#/search'))).toBe(-1);
  });

  it('pushStampedEntry stamps the new entry one level deeper at the same address', async () => {
    await link('#/a');
    const entry = pushStampedEntry(window.history.state, true);
    expect(entry.depth).toBe(2);
    expect(entry.layer).toBe(true);
    expect(readHistoryEntry(window.history.state)).toEqual(entry);
    expect(browser.hashes()).toEqual(['#/search', '#/a', '#/a']);
  });

  it('a reload on a layer entry turns it into a page: the layer is gone', () => {
    stop();
    resetHistoryEntryTrackingForTests();
    window.history.replaceState(withHistoryEntry(null, { id: 'old', depth: 1, layer: true }), '');
    stop = installHistoryEntryTracking();
    expect(readHistoryEntry(window.history.state)?.layer).toBeUndefined();
    expect(currentHistoryEntry().layer).toBeUndefined();
  });
});
