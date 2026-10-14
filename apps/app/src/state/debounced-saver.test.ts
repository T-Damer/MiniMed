import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebouncedSaver, flushPendingSaves } from '@/state/debounced-saver';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('debounced saver', () => {
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', windowEvents);
    vi.stubGlobal('document', documentEvents);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('saves only the newest value once typing pauses, and reports the write-ahead of each change', async () => {
    const saved: string[] = [];
    const ahead: [string, number][] = [];
    const saver = createDebouncedSaver<string>({
      delayMs: 300,
      save: async (value) => void saved.push(value),
      writeAhead: (value, version) => void ahead.push([value, version]),
      onError: (cause) => {
        throw cause;
      },
    });
    saver.schedule('a');
    await vi.advanceTimersByTimeAsync(200);
    saver.schedule('ab');
    await vi.advanceTimersByTimeAsync(200);
    // 200 ms after the second change: still waiting.
    expect(saved).toEqual([]);
    expect(saver.pending()).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(saved).toEqual(['ab']);
    expect(saver.pending()).toBe(false);
    expect(ahead).toEqual([
      ['a', 1],
      ['ab', 2],
    ]);
    saver.dispose();
  });

  it('never overlaps saves and saves a change made during a save afterwards', async () => {
    const gates = [deferred(), deferred()];
    const started: string[] = [];
    const saved: [string, number][] = [];
    let running = 0;
    let overlapped = false;
    const saver = createDebouncedSaver<string>({
      delayMs: 10,
      save: async (value) => {
        running += 1;
        overlapped ||= running > 1;
        started.push(value);
        await gates[started.length - 1]?.promise;
        running -= 1;
      },
      onSaved: (value, version) => void saved.push([value, version]),
      onError: (cause) => {
        throw cause;
      },
    });
    saver.schedule('one');
    await vi.advanceTimersByTimeAsync(10);
    expect(started).toEqual(['one']);
    saver.schedule('two');
    await vi.advanceTimersByTimeAsync(10);
    // The second timer fired while the first save runs: it waits.
    expect(started).toEqual(['one']);
    gates[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['one', 'two']);
    gates[1]?.resolve();
    await expect(saver.flush()).resolves.toBe(true);
    expect(overlapped).toBe(false);
    // Only the newest value counts as saved: the older write-ahead copy is obsolete then.
    expect(saved).toEqual([['two', 2]]);
    saver.dispose();
  });

  it('flush saves at once, without waiting for the pause', async () => {
    const saved: string[] = [];
    const saver = createDebouncedSaver<string>({
      delayMs: 60_000,
      save: async (value) => void saved.push(value),
      onError: (cause) => {
        throw cause;
      },
    });
    saver.schedule('typed');
    await expect(saver.flush()).resolves.toBe(true);
    expect(saved).toEqual(['typed']);
    await expect(saver.flush()).resolves.toBe(true);
    expect(saved).toEqual(['typed']);
    saver.dispose();
  });

  it('keeps the value pending after a failed save, reports it and retries on the next flush', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const saved: string[] = [];
    const saver = createDebouncedSaver<string>({
      delayMs: 10,
      save: async (value) => {
        if (fail) throw new Error('vault locked');
        saved.push(value);
      },
      onError: (cause) => void errors.push(cause),
    });
    saver.schedule('text');
    await expect(saver.flush()).resolves.toBe(false);
    expect(errors).toHaveLength(1);
    expect(saver.pending()).toBe(true);
    fail = false;
    await expect(saver.flush()).resolves.toBe(true);
    expect(saved).toEqual(['text']);
    expect(saver.pending()).toBe(false);
    saver.dispose();
  });

  it('flushes every pending saver when the page is hidden, unloaded or comes back', async () => {
    const saved: string[] = [];
    const saver = createDebouncedSaver<string>({
      delayMs: 60_000,
      save: async (value) => void saved.push(value),
      onError: (cause) => {
        throw cause;
      },
    });
    saver.schedule('before hide');
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(['before hide']);

    saver.schedule('before unload');
    windowEvents.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(['before hide', 'before unload']);

    saver.schedule('before reload');
    windowEvents.dispatchEvent(new Event('beforeunload'));
    await vi.advanceTimersByTimeAsync(0);
    expect(saved.at(-1)).toBe('before reload');
    await expect(flushPendingSaves()).resolves.toEqual([]);
    saver.dispose();
  });

  it('a disposed saver leaves the lifecycle and its timer', async () => {
    const saved: string[] = [];
    const saver = createDebouncedSaver<string>({
      delayMs: 10,
      save: async (value) => void saved.push(value),
      onError: (cause) => {
        throw cause;
      },
    });
    saver.schedule('late');
    saver.dispose();
    await vi.advanceTimersByTimeAsync(50);
    windowEvents.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual([]);
  });
});
