import { describe, expect, it, vi } from 'vitest';

import {
  aggregateDownloadFraction,
  type DownloadKind,
  DownloadQueue,
  downloadTaskFraction,
} from './download-queue';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush(): Promise<void> {
  for (let step = 0; step < 16; step++) await Promise.resolve();
}
const descriptor = (id: string, kind: DownloadKind = 'module') => ({
  id,
  kind,
  title: `Пакет ${id}`,
});

describe('shared download ownership', () => {
  it('uses one FIFO limit for core, packages, images, ECG, speech, models, documents and APKs', async () => {
    const queue = new DownloadQueue(3);
    const kinds: DownloadKind[] = [
      'core',
      'module',
      'images',
      'ecg',
      'speech',
      'model',
      'document',
      'app',
    ];
    const gates = kinds.map(gate);
    const started: number[] = [];
    let peak = 0;
    const jobs = kinds.map((kind, index) =>
      queue.run(descriptor(String(index), kind), (context) =>
        queue.transfer(context.id, context.id, context.signal, async () => {
          started.push(index);
          peak = Math.max(peak, queue.activeTransfers);
          await gates[index]?.promise;
        }),
      ),
    );
    await flush();
    expect(started).toEqual([0, 1, 2]);
    for (let index = 0; index < kinds.length; index++) {
      gates[index]?.resolve();
      await flush();
      expect(queue.activeTransfers).toBeLessThanOrEqual(3);
    }
    await Promise.all(jobs);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
    expect(queue.list().every((task) => task.state === 'completed')).toBe(true);
  });

  it('does not start a queued operation cancelled before admission', async () => {
    const queue = new DownloadQueue(1);
    const firstGate = gate();
    const first = queue.run(descriptor('one'), (ctx) =>
      queue.transfer(ctx.id, 'one', ctx.signal, () => firstGate.promise),
    );
    const start = vi.fn(async () => undefined);
    const second = queue.run(descriptor('two'), (ctx) =>
      queue.transfer(ctx.id, 'two', ctx.signal, start),
    );
    const rejected = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    await queue.cancel('two');
    await rejected;
    expect(start).not.toHaveBeenCalled();
    firstGate.resolve();
    await first;
  });

  it('keeps the active slot until cancellation really closes the transport', async () => {
    const queue = new DownloadQueue(1);
    const cleanup = gate();
    const first = queue.run(descriptor('one'), (ctx) =>
      queue.transfer(ctx.id, 'one', ctx.signal, async () => {
        await cleanup.promise;
        ctx.signal.throwIfAborted();
      }),
    );
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const start = vi.fn(async () => undefined);
    const second = queue.run(descriptor('two'), (ctx) =>
      queue.transfer(ctx.id, 'two', ctx.signal, start),
    );
    await flush();
    const cancellation = queue.cancel('one');
    await flush();
    expect(queue.get('one')?.state).toBe('cancelling');
    expect(queue.activeTransfers).toBe(1);
    expect(start).not.toHaveBeenCalled();
    cleanup.resolve();
    await cancellation;
    await rejected;
    await second;
    expect(start).toHaveBeenCalledOnce();
  });

  it('reports a cleanup failure instead of pretending cancellation succeeded', async () => {
    const queue = new DownloadQueue(1);
    const cleanup = gate();
    const job = queue.run(descriptor('one'), async () => {
      await cleanup.promise;
      throw new AggregateError([], 'stop failed');
    });
    const failed = expect(job).rejects.toThrow('stop failed');
    await flush();
    const cancellation = queue.cancel('one');
    const cancelFailed = expect(cancellation).rejects.toThrow('stop failed');
    cleanup.resolve();
    await failed;
    await cancelFailed;
    expect(queue.get('one')).toMatchObject({ state: 'failed', canRetry: false });
  });

  it('does not report 100 percent or complete until the full owner validates and commits', async () => {
    const queue = new DownloadQueue();
    const validation = gate();
    const job = queue.run(descriptor('core', 'core'), async (ctx) => {
      ctx.progress(100, 100);
      ctx.phase('verifying');
      await validation.promise;
    });
    await flush();
    expect(queue.get('core')?.state).toBe('verifying');
    const task = queue.get('core');
    expect(task && downloadTaskFraction(task)).toBe(0.99);
    validation.resolve();
    await job;
    const ready = queue.get('core');
    expect(ready && downloadTaskFraction(ready)).toBe(1);
  });

  it('does not label an uncancellable atomic installation cancelled', async () => {
    const queue = new DownloadQueue();
    const commit = gate();
    const external = new AbortController();
    const job = queue.run(
      descriptor('one'),
      async (ctx) => {
        ctx.phase('installing');
        await commit.promise;
      },
      { signal: external.signal },
    );
    await flush();
    external.abort();
    await queue.cancel('one');
    expect(queue.get('one')).toMatchObject({ state: 'installing', canCancel: false });
    commit.resolve();
    await job;
    expect(queue.get('one')?.state).toBe('completed');
  });

  it('deduplicates owners and serializes different consumers of the same staged key', async () => {
    const queue = new DownloadQueue(3);
    const staged = gate();
    const start = vi.fn(async () => undefined);
    const first = queue.run(descriptor('one'), (ctx) =>
      queue.transfer(ctx.id, 'same-file', ctx.signal, () => staged.promise),
    );
    expect(queue.run(descriptor('one'), start)).toBe(first);
    const second = queue.run(descriptor('two'), (ctx) =>
      queue.transfer(ctx.id, 'same-file', ctx.signal, start),
    );
    await flush();
    expect(start).not.toHaveBeenCalled();
    staged.resolve();
    await Promise.all([first, second]);
    expect(start).toHaveBeenCalledOnce();
  });

  it('runs local cached work offline without allowing new remote transfers', async () => {
    const queue = new DownloadQueue(1);
    queue.setOnline(false);
    const start = vi.fn(async () => undefined);
    const remote = queue.run(descriptor('remote'), (ctx) =>
      queue.transfer(ctx.id, ctx.id, ctx.signal, start),
    );
    const local = queue.run(descriptor('local'), (ctx) =>
      queue.transfer(ctx.id, ctx.id, ctx.signal, async () => 'cached', false),
    );
    await expect(local).resolves.toBe('cached');
    expect(start).not.toHaveBeenCalled();
    queue.setOnline(true);
    await remote;
    expect(start).toHaveBeenCalledOnce();
  });

  it('retry calls the full validation owner and never replays a persisted transport closure', async () => {
    const queue = new DownloadQueue();
    let attempt = 0;
    const execute = (): Promise<void> =>
      queue.run(
        descriptor('one'),
        async (ctx) => {
          attempt++;
          ctx.progress(10, 10);
          ctx.phase('verifying');
          if (attempt === 1) throw new Error('bad hash');
        },
        { retry: execute },
      );
    await expect(execute()).rejects.toThrow('bad hash');
    await queue.retry('one');
    expect(attempt).toBe(2);
    expect(queue.get('one')?.state).toBe('completed');
  });

  it('does not turn unknown-length active work into a fictitious aggregate percentage', async () => {
    const queue = new DownloadQueue();
    const done = gate();
    const first = queue.run(descriptor('one'), async (ctx) => {
      ctx.progress(80, 100);
      await done.promise;
    });
    const second = queue.run(descriptor('two'), async (ctx) => {
      ctx.progress(80, null);
      await done.promise;
    });
    await flush();
    expect(aggregateDownloadFraction(queue.list())).toBeNull();
    done.resolve();
    await Promise.all([first, second]);
  });

  it('persists only public recipe data and hydrates active work without starting it', () => {
    const journal = JSON.stringify({
      version: 1,
      tasks: [
        {
          ...descriptor('ecg', 'ecg'),
          state: 'downloading',
          downloadedBytes: 30,
          totalBytes: 100,
          resume: {
            kind: 'ecg-package',
            id: 'approved',
            version: 'edition',
            url: 'https://evil.invalid',
            token: 'secret',
          },
        },
        { ...descriptor('invalid'), state: 'invented' },
      ],
    });
    const save = vi.fn();
    const queue = new DownloadQueue(3, { load: () => journal, save });
    expect(queue.list()).toHaveLength(1);
    expect(queue.activeTransfers).toBe(0);
    expect(queue.get('ecg')).toMatchObject({
      state: 'interrupted',
      canRetry: false,
      resume: { kind: 'ecg-package', id: 'approved', version: 'edition' },
    });
    queue.setOnline(true);
    expect(JSON.stringify(queue.list())).not.toContain('evil.invalid');
    expect(JSON.stringify(queue.list())).not.toContain('secret');
  });

  it('retains installed data when queue storage is corrupt or unavailable', async () => {
    const queue = new DownloadQueue(3, {
      load: () => '{broken',
      save: () => {
        throw new Error('quota');
      },
    });
    expect(queue.getStorageError()).not.toBeNull();
    await queue.run(descriptor('one'), async () => undefined);
    expect(queue.get('one')?.state).toBe('completed');
    expect(queue.getStorageError()).not.toBeNull();
  });

  it('bounds completed history without deleting active jobs', async () => {
    const queue = new DownloadQueue();
    const done = gate();
    const active = queue.run(descriptor('active'), () => done.promise);
    for (let index = 0; index < 130; index++)
      await queue.run(descriptor(String(index)), async () => undefined);
    expect(queue.list()).toHaveLength(101);
    expect(queue.get('active')).toBeDefined();
    queue.clearFinished();
    expect(queue.list()).toHaveLength(1);
    done.resolve();
    await active;
  });

  it('keeps domain cancellation pending until the installer acknowledges cleanup', async () => {
    const queue = new DownloadQueue();
    const cleanup = gate();
    const controls = { cancel: () => cleanup.promise };
    queue.observe(descriptor('module'), { state: 'downloading' }, controls);
    const cancellation = queue.cancel('module');
    queue.observe(descriptor('module'), { state: 'downloading', downloadedBytes: 1 }, controls);
    expect(queue.get('module')).toMatchObject({ state: 'cancelling', canCancel: false });
    cleanup.resolve();
    await cancellation;
    expect(queue.get('module')?.state).toBe('cancelled');
  });
});
