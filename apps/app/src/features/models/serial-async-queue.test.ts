import { describe, expect, it } from 'vitest';

import { SerialAsyncQueue } from './serial-async-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

describe('SerialAsyncQueue', () => {
  it('runs asynchronous tasks one at a time and preserves order', async () => {
    const queue = new SerialAsyncQueue();
    const first = deferred<string>();
    const events: string[] = [];
    let active = 0;
    let peak = 0;

    const firstRun = queue.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      events.push('first:start');
      const value = await first.promise;
      events.push('first:end');
      active -= 1;
      return value;
    });
    const secondRun = queue.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      events.push('second:start');
      active -= 1;
      return 'second';
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    first.resolve('first');

    await expect(firstRun).resolves.toBe('first');
    await expect(secondRun).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(peak).toBe(1);
  });

  it('continues after a rejected task', async () => {
    const queue = new SerialAsyncQueue();

    await expect(
      queue.run(async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    await expect(queue.run(async () => 'recovered')).resolves.toBe('recovered');
  });

  it('waits for active work during close and rejects new work', async () => {
    const queue = new SerialAsyncQueue();
    const work = deferred<void>();
    const running = queue.run(() => work.promise);
    const closing = queue.close();

    await expect(queue.run(async () => 'late')).rejects.toThrow('закрыта');
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    work.resolve();
    await running;
    await closing;
    expect(closed).toBe(true);
  });
});
