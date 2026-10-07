import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyArrival,
  currentHistoryEntry,
  flushReaderPositions,
  hasInAppPreviousEntry,
  installHistoryEntryTracking,
  observeHistoryEntry,
  readHistoryEntry,
  registerReaderPositionFlusher,
  resetHistoryEntryTrackingForTests,
  saveReaderPosition,
  withHistoryEntry,
} from '@/state/history-entries';

/** A small stand-in for the browser's session history: a list of entries and a cursor. */
function fakeHistory() {
  const entries: Array<{ state: unknown; hash: string }> = [{ state: null, hash: '#/search' }];
  let index = 0;
  const listeners = new Map<string, Set<() => void>>();
  const emit = (name: string): void => {
    for (const listener of listeners.get(name) ?? []) listener();
  };
  const fakeWindow = {
    history: {
      get state() {
        return entries[index]?.state ?? null;
      },
      get length() {
        return entries.length;
      },
      replaceState(state: unknown) {
        const entry = entries[index];
        if (entry) entry.state = state;
      },
      back() {
        if (index > 0) {
          index -= 1;
          emit('popstate');
        }
      },
    },
    location: {
      get hash() {
        return entries[index]?.hash ?? '';
      },
      set hash(value: string) {
        // A fragment navigation adds an entry (dropping any forward ones) and raises both events.
        entries.splice(index + 1);
        entries.push({ state: null, hash: value });
        index += 1;
        emit('popstate');
        emit('hashchange');
      },
    },
    addEventListener(name: string, listener: () => void) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
    },
    removeEventListener(name: string, listener: () => void) {
      listeners.get(name)?.delete(listener);
    },
  };
  return { fakeWindow, entries };
}

describe('history entry stamps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetHistoryEntryTrackingForTests();
  });

  it('reads only a well-formed stamp', () => {
    expect(readHistoryEntry(null)).toBeNull();
    expect(readHistoryEntry({ minimedEntry: { id: '', depth: 0 } })).toBeNull();
    expect(readHistoryEntry({ minimedEntry: { id: 'a', depth: -1 } })).toBeNull();
    expect(readHistoryEntry({ minimedEntry: { id: 'a', depth: 1.5 } })).toBeNull();
    expect(readHistoryEntry({ minimedEntry: { id: 'a', depth: 2 } })).toEqual({
      id: 'a',
      depth: 2,
    });
    expect(
      readHistoryEntry({
        minimedEntry: { id: 'a', depth: 0, position: { anchor: 's1', offset: -12 } },
      }),
    ).toEqual({ id: 'a', depth: 0, position: { anchor: 's1', offset: -12 } });
    // A malformed position is dropped, the stamp stays.
    expect(
      readHistoryEntry({
        minimedEntry: { id: 'a', depth: 0, position: { anchor: '', offset: 3 } },
      }),
    ).toEqual({ id: 'a', depth: 0 });
  });

  it('keeps the other keys of the state when it stamps', () => {
    const next = withHistoryEntry({ view: 'search' }, { id: 'a', depth: 1 });
    expect(next).toEqual({ view: 'search', minimedEntry: { id: 'a', depth: 1 } });
  });

  it('stamps a pushed entry one deeper and an unknown arrival at depth 0', () => {
    const previous = { id: 'p', depth: 2 };
    const pushed = classifyArrival({ state: null, length: 5, previous, previousLength: 4 });
    expect(pushed?.depth).toBe(3);
    const unknown = classifyArrival({ state: null, length: 4, previous, previousLength: 4 });
    expect(unknown?.depth).toBe(0);
    const first = classifyArrival({ state: null, length: 1, previous: null, previousLength: 0 });
    expect(first?.depth).toBe(0);
    expect(
      classifyArrival({
        state: withHistoryEntry(null, previous),
        length: 9,
        previous,
        previousLength: 1,
      }),
    ).toBeNull();
  });

  it('counts the in-app entries below the page through pushes and back steps', () => {
    const { fakeWindow } = fakeHistory();
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const stop = installHistoryEntryTracking();
    // The page the app started on has nothing below it.
    expect(hasInAppPreviousEntry()).toBe(false);

    fakeWindow.location.hash = '#/modules/documents/d/a';
    expect(hasInAppPreviousEntry()).toBe(true);
    expect(currentHistoryEntry().depth).toBe(1);
    fakeWindow.location.hash = '#/modules/documents/d/b';
    expect(currentHistoryEntry().depth).toBe(2);

    fakeWindow.history.back();
    expect(currentHistoryEntry().depth).toBe(1);
    fakeWindow.history.back();
    expect(hasInAppPreviousEntry()).toBe(false);
    stop();
  });

  it('treats an entry opened by a deep link as having nothing to go back to', () => {
    const { fakeWindow } = fakeHistory();
    vi.stubGlobal('window', fakeWindow);
    expect(observeHistoryEntry().depth).toBe(0);
    expect(hasInAppPreviousEntry()).toBe(false);
  });

  it('saves a position only on the entry it belongs to', () => {
    const { fakeWindow, entries } = fakeHistory();
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const stop = installHistoryEntryTracking();
    fakeWindow.location.hash = '#/modules/documents/d/a';
    const first = currentHistoryEntry();
    expect(saveReaderPosition(first.id, { anchor: 's3', offset: 140 })).toBe(true);
    expect(currentHistoryEntry().position).toEqual({ anchor: 's3', offset: 140 });

    fakeWindow.location.hash = '#/modules/documents/d/b';
    // A late write from the reader of the first document must not land on the second entry.
    expect(saveReaderPosition(first.id, { anchor: 'late', offset: 1 })).toBe(false);
    expect(currentHistoryEntry().position).toBeUndefined();

    fakeWindow.history.back();
    expect(currentHistoryEntry().position).toEqual({ anchor: 's3', offset: 140 });
    expect(entries).toHaveLength(3);
    stop();
  });

  it('flushes every registered reader', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = registerReaderPositionFlusher(first);
    registerReaderPositionFlusher(second);
    flushReaderPositions();
    stopFirst();
    flushReaderPositions();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
