import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReaderJumpHistory } from '@/features/library/reader-jump-history';
import {
  currentHistoryEntry,
  installHistoryEntryTracking,
  pushStampedEntry,
  readHistoryEntry,
  resetHistoryEntryTrackingForTests,
  saveReaderPosition,
} from '@/state/history-entries';
import { type FakeBrowser, installFakeBrowser } from '@/state/history-test-double';

let browser: FakeBrowser;
let stop: () => void;

beforeEach(() => {
  browser = installFakeBrowser({ hash: '#/modules/documents/d/x', search: '' });
  stop = installHistoryEntryTracking();
});

afterEach(() => {
  stop();
  resetHistoryEntryTrackingForTests();
  browser.restore();
});

describe('reader jump history', () => {
  it('a jump saves the place it left from and pushes a step at the same address', () => {
    const jumps = createReaderJumpHistory({ entryId: currentHistoryEntry().id, restore: vi.fn() });
    jumps.record({ anchor: 'intro', offset: 12 });
    expect(browser.entries).toHaveLength(2);
    expect(browser.hashes()).toEqual(['#/modules/documents/d/x', '#/modules/documents/d/x']);
    // The place was saved on the entry the reader jumped from.
    expect(readHistoryEntry(browser.entries[0]?.state)?.position).toEqual({
      anchor: 'intro',
      offset: 12,
    });
    expect(jumps.owns(currentHistoryEntry().id)).toBe(true);
    jumps.dispose();
  });

  it('back restores the saved place in the same document, and forward the place jumped to', async () => {
    const restore = vi.fn();
    const jumps = createReaderJumpHistory({ entryId: currentHistoryEntry().id, restore });
    jumps.record({ anchor: 'intro', offset: 12 });
    // The reader lands on the section and saves its place on the step.
    saveReaderPosition(currentHistoryEntry().id, { anchor: 'dosing', offset: 0 });

    window.history.back();
    await browser.settle();
    expect(restore).toHaveBeenLastCalledWith({ anchor: 'intro', offset: 12 });

    window.history.forward();
    await browser.settle();
    expect(restore).toHaveBeenLastCalledWith({ anchor: 'dosing', offset: 0 });
    jumps.dispose();
  });

  it('leaves entries it does not own alone (another document, a layer over the reader)', async () => {
    const restore = vi.fn();
    const jumps = createReaderJumpHistory({ entryId: 'someone-else', restore });
    jumps.record({ anchor: 'intro', offset: 1 });
    expect(browser.entries).toHaveLength(1);
    window.location.hash = '#/search';
    await browser.settle();
    window.history.back();
    await browser.settle();
    expect(restore).not.toHaveBeenCalled();
    jumps.dispose();
  });
  it('a reader made on a dead layer adopts the page entry the history lands on', async () => {
    const restore = vi.fn();
    // The reader of document A, opened out of a preview layer, is made while the history is on the
    // layer's entry; the history then steps over it to A's own entry.
    saveReaderPosition(currentHistoryEntry().id, { anchor: 'dosing', offset: 4 });
    const layer = pushStampedEntry(null, true);
    expect(layer.position).toEqual({ anchor: 'dosing', offset: 4 });
    const jumps = createReaderJumpHistory({ restore });
    expect(jumps.owns(layer.id)).toBe(false);
    window.history.back();
    await browser.settle();
    const page = currentHistoryEntry();
    expect(jumps.owns(page.id)).toBe(true);
    expect(restore).toHaveBeenLastCalledWith({ anchor: 'dosing', offset: 4 });
    jumps.dispose();
  });
});
