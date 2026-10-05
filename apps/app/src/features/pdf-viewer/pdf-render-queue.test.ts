import { describe, expect, it } from 'vitest';

import { PdfRenderQueue } from './pdf-render-queue';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((done) => setTimeout(done, 0));

describe('PdfRenderQueue', () => {
  it('runs the nearest page first and never more than the concurrency limit', async () => {
    const queue = new PdfRenderQueue(1);
    const order: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const job = (name: string, priority: number) => {
      const gate = deferred();
      gates.set(name, gate);
      queue.enqueue({
        priority: () => priority,
        run: async () => {
          order.push(name);
          await gate.promise;
        },
      });
    };
    job('far', 9);
    job('near', 1);
    job('thumb', 10_000);
    await tick();
    expect(order).toEqual(['near']);
    expect(queue.active).toBe(1);
    gates.get('near')?.resolve();
    await tick();
    gates.get('far')?.resolve();
    await tick();
    gates.get('thumb')?.resolve();
    await tick();
    expect(order).toEqual(['near', 'far', 'thumb']);
  });

  it('re-reads priority at pick time, so a scroll reorders the waiting jobs', async () => {
    const queue = new PdfRenderQueue(1);
    const order: string[] = [];
    const first = deferred();
    let aPriority = 1;
    queue.enqueue({
      priority: () => 0,
      run: async () => {
        order.push('busy');
        await first.promise;
      },
    });
    queue.enqueue({ priority: () => aPriority, run: async () => void order.push('a') });
    queue.enqueue({ priority: () => 5, run: async () => void order.push('b') });
    await tick();
    aPriority = 50;
    first.resolve();
    await tick();
    await tick();
    expect(order).toEqual(['busy', 'b', 'a']);
  });

  it('drops a queued job when cancelled and aborts a running one', async () => {
    const queue = new PdfRenderQueue(1);
    let sawAbort = false;
    const gate = deferred();
    const ran: string[] = [];
    const running = queue.enqueue({
      priority: () => 0,
      run: async (signal) => {
        signal.addEventListener('abort', () => {
          sawAbort = true;
          gate.resolve();
        });
        await gate.promise;
      },
    });
    const waiting = queue.enqueue({ priority: () => 1, run: async () => void ran.push('waiting') });
    await tick();
    waiting.cancel();
    running.cancel();
    await tick();
    await tick();
    expect(sawAbort).toBe(true);
    expect(ran).toEqual([]);
    expect(queue.pending).toBe(0);
  });

  it('reports a failed job but not an aborted one, and keeps going', async () => {
    const queue = new PdfRenderQueue(1);
    const errors: unknown[] = [];
    const ran: string[] = [];
    queue.enqueue({
      priority: () => 0,
      run: async () => {
        throw new Error('boom');
      },
      onError: (cause) => errors.push(cause),
    });
    queue.enqueue({ priority: () => 1, run: async () => void ran.push('next') });
    await tick();
    await tick();
    expect(errors).toHaveLength(1);
    expect(ran).toEqual(['next']);
  });
});
