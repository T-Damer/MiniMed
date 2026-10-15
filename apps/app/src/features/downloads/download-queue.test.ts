import { describe, expect, it, vi } from 'vitest';

import catalog from '../modules/catalog.preview.json';
import {
  aggregateDownloadFraction,
  type DownloadKind,
  DownloadQueue,
  downloadDisplayTitle,
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

  describe('long display titles', () => {
    const longClinicalTitles = catalog.modules.filter((module) => module.title.length > 180);

    it('covers the eight real clinical recommendations with titles over 180 characters', () => {
      expect(longClinicalTitles.map((module) => module.id.split('.').pop()).sort()).toEqual(
        expect.arrayContaining([
          '129_3',
          '32_2',
          '759_1',
          '759_2',
          '766_1',
          '795_1',
          '817_1',
          '888_1',
        ]),
      );
    });

    it('queues and completes every real long-title module, clipping only the label', async () => {
      const queue = new DownloadQueue();
      for (const module of longClinicalTitles) {
        await queue.run({ id: module.id, kind: 'module', title: module.title }, async () => 'ok');
        const task = queue.get(module.id);
        expect(task?.state).toBe('completed');
        expect(Array.from(task?.title ?? '').length).toBeLessThanOrEqual(180);
        expect(task?.title.endsWith('…')).toBe(true);
        expect(module.title.startsWith((task?.title ?? '').slice(0, -1))).toBe(true);
      }
    });

    it('clips the 307-character 888_1 title at a word boundary', () => {
      const module = catalog.modules.find((item) => item.id.endsWith('888_1'));
      expect(module?.title.length).toBe(307);
      const title = downloadDisplayTitle(module?.title) ?? '';
      expect(Array.from(title).length).toBeLessThanOrEqual(180);
      expect(title.endsWith('…')).toBe(true);
      const kept = title.slice(0, -1);
      expect(module?.title.startsWith(kept)).toBe(true);
      expect(module?.title.charAt(kept.length)).toMatch(/[\s,;:.([{–—-]/u);
      expect(kept).not.toMatch(/[\s,;:.([{–—-]$/u);
    });

    it('falls back to a hard cut when the label has no late word boundary', () => {
      const title = downloadDisplayTitle(`${'а'.repeat(170)} ${'б'.repeat(40)}`) ?? '';
      expect(title).toBe(`${'а'.repeat(170)}…`);
      expect(downloadDisplayTitle('я'.repeat(400))).toBe(`${'я'.repeat(179)}…`);
    });

    it('keeps short titles intact and still rejects bad ids, kinds and titles', () => {
      expect(downloadDisplayTitle('Пакет')).toBe('Пакет');
      expect(downloadDisplayTitle('')).toBeNull();
      expect(downloadDisplayTitle('a\u0007b')).toBeNull();
      const queue = new DownloadQueue();
      const operation = async (): Promise<void> => undefined;
      const invalid = [
        { id: '', kind: 'module' as DownloadKind, title: 'x' },
        { id: 'x'.repeat(513), kind: 'module' as DownloadKind, title: 'x' },
        { id: 'a', kind: 'module' as DownloadKind, title: '' },
        { id: 'a', kind: 'bogus' as DownloadKind, title: 'x' },
      ];
      for (const item of invalid) {
        expect(() => queue.run(item, operation)).toThrow('Invalid download descriptor.');
      }
    });
  });
});

describe('pause and resume of module downloads', () => {
  /** A transport that streams until aborted, then keeps its "partial bytes" like the real one. */
  function streamingTransport(partial: { bytes: number }) {
    const starts: number[] = [];
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const transport = async (attempt: AbortSignal): Promise<string> => {
      starts.push(partial.bytes);
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => {
          partial.bytes += 40; // flushed before the abort is reported, as downloadWithResume does
          reject(new DOMException('Download aborted.', 'AbortError'));
        };
        if (attempt.aborted) abort();
        attempt.addEventListener('abort', abort, { once: true });
        void finished.then(resolve);
      });
      return 'bytes';
    };
    return { starts, transport, finish };
  }

  it('interrupts a running module transfer without failing it, then resumes it from its partial bytes', async () => {
    const queue = new DownloadQueue(3);
    const partial = { bytes: 0 };
    const { starts, transport, finish } = streamingTransport(partial);
    const job = queue.run(descriptor('m'), (ctx) =>
      queue.transfer(ctx.id, 'm', ctx.signal, transport),
    );
    await flush();
    expect(queue.get('m')?.state).toBe('downloading');
    queue.setPaused(true);
    await flush();
    expect(queue.isPaused()).toBe(true);
    expect(queue.get('m')).toMatchObject({ state: 'paused', canCancel: true });
    expect(queue.activeTransfers).toBe(0);
    expect(starts).toEqual([0]);
    queue.setPaused(false);
    await flush();
    expect(starts).toEqual([0, 40]); // the second attempt starts from what the first one kept
    expect(queue.get('m')?.state).toBe('downloading');
    finish();
    await expect(job).resolves.toBe('bytes');
    expect(queue.get('m')?.state).toBe('completed');
  });

  it('does not start waiting module transfers while paused, and starts them on resume', async () => {
    const queue = new DownloadQueue(3);
    const first = gate();
    const running = queue.run(descriptor('first'), (ctx) =>
      queue.transfer(ctx.id, 'first', ctx.signal, () => first.promise),
    );
    await flush();
    queue.setPaused(true);
    const start = vi.fn(async () => 'ok');
    const job = queue.run(descriptor('late'), (ctx) =>
      queue.transfer(ctx.id, 'late', ctx.signal, start),
    );
    await flush();
    expect(start).not.toHaveBeenCalled();
    expect(queue.get('late')?.state).toBe('paused');
    queue.setPaused(false);
    await flush();
    await expect(job).resolves.toBe('ok');
    expect(start).toHaveBeenCalledOnce();
    first.resolve();
    await flush();
    await running.catch(() => undefined);
  });

  it('holds only module downloads', async () => {
    const queue = new DownloadQueue(3);
    const module = gate();
    const moduleJob = queue.run(descriptor('mod'), (ctx) =>
      queue.transfer(ctx.id, 'mod', ctx.signal, () => module.promise),
    );
    await flush();
    queue.setPaused(true);
    const image = vi.fn(async () => 'image');
    await queue.run(descriptor('img', 'images'), (ctx) =>
      queue.transfer(ctx.id, 'img', ctx.signal, image),
    );
    expect(image).toHaveBeenCalledOnce();
    expect(queue.get('img')?.state).toBe('completed');
    queue.setPaused(false);
    module.resolve();
    await moduleJob;
  });

  it('lets a paused download be cancelled', async () => {
    const queue = new DownloadQueue(3);
    const { transport } = streamingTransport({ bytes: 0 });
    const job = queue.run(descriptor('m'), (ctx) =>
      queue.transfer(ctx.id, 'm', ctx.signal, transport),
    );
    const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    queue.setPaused(true);
    await flush();
    await queue.cancel('m');
    await rejected;
    expect(queue.get('m')?.state).toBe('cancelled');
    expect(queue.isPaused()).toBe(false); // nothing is left to hold
  });

  it('remembers the pause across a reload and keeps reporting it for unfinished module work', () => {
    let journal: string | null = null;
    const persistence = {
      load: () => journal,
      save: (value: string) => {
        journal = value;
      },
    };
    const queue = new DownloadQueue(3, persistence);
    queue.observe(descriptor('m'), { state: 'downloading', downloadedBytes: 10 }, {});
    queue.setPaused(true);
    expect(JSON.parse(journal ?? '{}')).toMatchObject({ version: 1, paused: true });

    const reloaded = new DownloadQueue(3, persistence);
    expect(reloaded.isPaused()).toBe(true);
    expect(reloaded.get('m')?.state).toBe('interrupted');
    expect(reloaded.canPause()).toBe(true);
    // The owner picks the download up again: it is held, not started.
    reloaded.observe(descriptor('m'), { state: 'queued' }, {});
    expect(reloaded.get('m')?.state).toBe('paused');
    reloaded.setPaused(false);
    expect(reloaded.get('m')?.state).toBe('queued');
  });

  it('ends a pause that no module download is left to hold', () => {
    const queue = new DownloadQueue(3);
    queue.observe(descriptor('m'), { state: 'downloading' }, {});
    queue.setPaused(true);
    expect(queue.isPaused()).toBe(true);
    queue.observe(descriptor('m'), { state: 'completed' }, {});
    expect(queue.isPaused()).toBe(false);
    expect(queue.canPause()).toBe(false);
  });
});
