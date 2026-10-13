import { describe, expect, it, vi } from 'vitest';

import { checkWebAppUpdate, waitForWorkerInstalled, watchForAppUpdates } from '@/state/app-update';

describe('waiting for an installing build', () => {
  function createWorker(state: ServiceWorkerState) {
    const listeners = new Set<() => void>();
    const worker = {
      state,
      addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
    };
    return {
      worker,
      listeners,
      become(next: ServiceWorkerState) {
        worker.state = next;
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it('resolves when the worker has installed and stops listening', async () => {
    vi.useFakeTimers();
    const { worker, listeners, become } = createWorker('installing');
    const done = vi.fn();
    void waitForWorkerInstalled(worker, 5_000).then(done);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(done).not.toHaveBeenCalled();
    become('installed');
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    vi.useRealTimers();
  });

  it('resolves for a worker that failed, and gives up after the timeout', async () => {
    vi.useFakeTimers();
    await expect(waitForWorkerInstalled(createWorker('redundant').worker, 5_000)).resolves.toBe(
      undefined,
    );
    const slow = createWorker('installing');
    const done = vi.fn();
    void waitForWorkerInstalled(slow.worker, 5_000).then(done);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(slow.listeners.size).toBe(0);
    vi.useRealTimers();
  });

  it('a check that finds an installing build announces it once it is waiting', async () => {
    const waiting = {} as ServiceWorker;
    const registration = {
      installing: {} as ServiceWorker,
      waiting: null as ServiceWorker | null,
      update: vi.fn(async () => undefined),
    };
    const dispatchReady = vi.fn();
    const ready = await checkWebAppUpdate(
      async () => registration as unknown as ServiceWorkerRegistration,
      dispatchReady,
      async () => {
        registration.waiting = waiting;
      },
    );
    expect(ready).toBe(true);
    expect(dispatchReady).toHaveBeenCalledWith(waiting);
  });

  it('a check with nothing new reports no update', async () => {
    const registration = { installing: null, waiting: null, update: vi.fn(async () => undefined) };
    const dispatchReady = vi.fn();
    const waitInstalled = vi.fn();
    await expect(
      checkWebAppUpdate(
        async () => registration as unknown as ServiceWorkerRegistration,
        dispatchReady,
        waitInstalled,
      ),
    ).resolves.toBe(false);
    expect(waitInstalled).not.toHaveBeenCalled();
    expect(dispatchReady).not.toHaveBeenCalled();
  });
});

describe('looking for updates in a long-lived tab', () => {
  function createPage(start: number) {
    let now = start;
    let visible = true;
    let wake: () => void = () => undefined;
    const unsubscribe = vi.fn();
    return {
      page: {
        visible: () => visible,
        now: () => now,
        onWake: (listener: () => void) => {
          wake = listener;
          return unsubscribe;
        },
      },
      unsubscribe,
      wakeAt(at: number, isVisible = true) {
        now = at;
        visible = isVisible;
        wake();
      },
    };
  }

  it('asks at most once per interval, only while the page is shown', () => {
    const registration = { update: vi.fn(async () => undefined) };
    const { page, wakeAt } = createPage(0);
    watchForAppUpdates(registration, page, 60_000);
    wakeAt(30_000);
    expect(registration.update).not.toHaveBeenCalled();
    wakeAt(61_000, false);
    expect(registration.update).not.toHaveBeenCalled();
    wakeAt(62_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    wakeAt(100_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    wakeAt(123_000);
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('does not fail the page when the check cannot reach the server', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const registration = {
      update: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    };
    const { page, wakeAt } = createPage(0);
    watchForAppUpdates(registration, page, 10);
    wakeAt(100);
    await vi.waitFor(() => expect(debug).toHaveBeenCalled());
    debug.mockRestore();
  });

  it('returns the unsubscribe of the wake-up source', () => {
    const { page, unsubscribe } = createPage(0);
    watchForAppUpdates({ update: async () => undefined }, page)();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
