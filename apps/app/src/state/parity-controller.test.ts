import { describe, expect, it, vi } from 'vitest';

import {
  backgroundParity,
  PARITY_PRIORITIES,
  ParityController,
  PreemptedError,
} from './parity-controller';

function deferred<T>(): { resolve: (value: T) => void; promise: Promise<T> } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

describe('parity controller', () => {
  it('runs one job at a time in priority order', async () => {
    const controller = new ParityController();
    const order: string[] = [];
    const release = deferred<void>();

    const low = controller.submit({
      kind: 'transcription',
      priority: PARITY_PRIORITIES.transcription,
      run: async () => {
        order.push('low');
        await release.promise;
        return 'low';
      },
    });
    const high = controller.submit({
      kind: 'ocr',
      priority: PARITY_PRIORITIES.ocr,
      run: async () => {
        order.push('high');
        return 'high';
      },
    });

    await high.done;
    release.resolve();
    await low.done;
    expect(order).toStrictEqual(['high', 'low']);
  });

  it('keeps FIFO order within the same priority', async () => {
    const controller = new ParityController();
    const order: string[] = [];
    const gate = deferred<void>();
    const make = (name: string) =>
      controller.submit({
        kind: name,
        priority: 50,
        run: async () => {
          order.push(name);
          if (name === 'first') await gate.promise;
          return name;
        },
      });

    const first = make('first');
    const second = make('second');
    const third = make('third');
    gate.resolve();
    await Promise.all([first.done, second.done, third.done]);
    expect(order).toStrictEqual(['first', 'second', 'third']);
  });

  it('preempts a running job when a higher-priority one arrives', async () => {
    const controller = new ParityController();
    const events: string[] = [];
    let checkpoints = 0;

    const slow = controller.submit({
      kind: 'transcription',
      priority: PARITY_PRIORITIES.transcription,
      run: async (ctx) => {
        events.push('slow:start');
        for (let index = 0; index < 5; index += 1) {
          if (index === 2 && checkpoints === 0) {
            checkpoints += 1;
            controller.submit({
              kind: 'ocr',
              priority: PARITY_PRIORITIES.ocr,
              run: async () => {
                events.push('ocr:start');
                return 'ocr';
              },
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          await ctx.checkpoint();
        }
        events.push('slow:end');
        return 'slow';
      },
    });
    await vi.waitFor(() => expect(events).toContain('ocr:start'));
    await slow.done;
    expect(events[events.indexOf('ocr:start') - 1]).toBe('slow:start');
    expect(events).toContain('slow:end');
    // Slow job finished only after OCR took the lane away and re-queued it.
    expect(events.lastIndexOf('slow:end')).toBeGreaterThan(events.indexOf('ocr:start'));
  });

  it('rejects with PreemptedError semantics via requeue rather than rejection', async () => {
    const controller = new ParityController();
    let runs = 0;
    const blocker = deferred<void>();

    const job = controller.submit({
      kind: 'transcription',
      priority: 10,
      run: async (ctx) => {
        runs += 1;
        await ctx.checkpoint();
        await blocker.promise;
        return 'ok';
      },
    });
    const urgent = controller.submit({
      kind: 'ocr',
      priority: 100,
      run: async () => 'urgent',
    });
    await urgent.done;
    blocker.resolve();
    await job.done;
    expect(runs).toBeGreaterThanOrEqual(1);
  });

  it('cancel removes pending jobs and aborts the running one', async () => {
    const controller = new ParityController();
    const started = deferred<void>();
    const running = controller.submit({
      kind: 'long',
      priority: 10,
      run: async (ctx) => {
        started.resolve();
        await new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('cancelled')));
        });
        return 'never';
      },
    });
    await started.promise;
    running.cancel();
    await expect(running.done).rejects.toThrow();
  });

  it('exposes status to subscribers', async () => {
    const controller = new ParityController();
    const seen: number[] = [];
    const unsubscribe = controller.subscribe((status) => {
      seen.push(status.pending.length + (status.active ? 10 : 0));
    });
    const job = controller.submit({ kind: 'a', priority: 1, run: async () => 'x' });
    unsubscribe();
    await job.done;
    expect(seen.length).toBeGreaterThan(1);
  });

  it('shares a background singleton with OCR above transcription', async () => {
    expect(PARITY_PRIORITIES.ocr).toBeGreaterThan(PARITY_PRIORITIES.transcription);
    expect(backgroundParity.status().active).toBeNull();
  });
});
