import { describe, expect, it } from 'vitest';

import { createSerialQueue } from '@/state/serial-queue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createSerialQueue', () => {
  it('never runs two tasks at once and keeps the order', async () => {
    const queue = createSerialQueue();
    const events: string[] = [];
    const firstGate = deferred();
    const first = queue.run(async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 1;
    });
    const second = queue.run(async () => {
      events.push('second:start');
      return 2;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    firstGate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('runs the next task after a failure and reports each failure to its own caller', async () => {
    const queue = createSerialQueue();
    const failing = queue.run(async () => {
      throw new Error('первая');
    });
    const next = queue.run(async () => 'вторая');
    await expect(failing).rejects.toThrow('первая');
    await expect(next).resolves.toBe('вторая');
  });
});
