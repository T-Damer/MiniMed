import { describe, expect, it, vi } from 'vitest';

import { ModuleShelf, type ShelfWorker } from '@/composition/module-shelf';
import {
  isOrphanedShelfFile,
  SHELF_CACHE_BUDGET_KIB,
  shelfCacheBudgetKiB,
  shelfCacheKiB,
  shelfFileName,
  shelfFileVersionKey,
  shelfPoolName,
  shelfShardOf,
} from '@/composition/module-shelf-names';
import type { ShelfRequest, ShelfResponse } from '@/composition/module-shelf-protocol';

const SHA = `sha256:${'a'.repeat(64)}`;
const HEALTH = { schemaVersion: 2, contentPackIds: ['pack'], documentCount: 1 };

/** A shelf worker that answers like the real one and keeps what the client sent it. */
function fakeWorker(handler?: (request: ShelfRequest) => ShelfResponse | undefined) {
  const requests: ShelfRequest[] = [];
  const worker: ShelfWorker & { terminated: boolean } = {
    terminated: false,
    onmessage: null,
    onerror: null,
    terminate() {
      this.terminated = true;
    },
    postMessage(message) {
      requests.push(message);
      queueMicrotask(() => {
        const custom = handler?.(message);
        if (custom) {
          worker.onmessage?.({ data: custom } as MessageEvent<ShelfResponse>);
          return;
        }
        let result: unknown;
        if (message.type === 'batch') {
          result = message.calls.map((call) => ({
            value: call.method === 'getHealth' ? HEALTH : `${call.method}:${call.file}`,
          }));
        }
        worker.onmessage?.({ data: { id: message.id, result } } as MessageEvent<ShelfResponse>);
      });
    },
  };
  return { worker, requests };
}

describe('shelf names', () => {
  it('names a file after its version key and checksum and reads the version back', () => {
    const name = shelfFileName('minimed.clinical.recommendation.1_1@0.6.0', SHA);
    expect(name).toMatch(/\.db$/u);
    expect(name).not.toContain('/');
    expect(shelfFileVersionKey(`/${name}`)).toBe('minimed.clinical.recommendation.1_1@0.6.0');
    expect(shelfFileVersionKey(shelfFileName('a@1'))).toBe('a@1');
  });

  it('never treats a journal or another file of the pool as an orphan', () => {
    const referenced = new Set(['a@1']);
    expect(isOrphanedShelfFile(`/${shelfFileName('a@1', SHA)}`, referenced)).toBe(false);
    expect(isOrphanedShelfFile(`/${shelfFileName('b@1', SHA)}`, referenced)).toBe(true);
    expect(isOrphanedShelfFile(`/${shelfFileName('b@1', SHA)}-journal`, referenced)).toBe(false);
    expect(isOrphanedShelfFile('/scratch', referenced)).toBe(false);
    // A size-qualified name (`.db.<bytes>`) belongs to the same version.
    expect(isOrphanedShelfFile(`/${shelfFileName('b@1', SHA)}.2048`, referenced)).toBe(true);
  });

  it('shares one memory budget between the connections whatever their number', () => {
    for (const count of [1, 40, 300, 774, 2000]) {
      const perConnection = -shelfCacheKiB(count);
      // Past a few hundred modules every connection keeps its floor; before that the sum stays inside.
      if (perConnection > 256)
        expect(perConnection * count).toBeLessThanOrEqual(SHELF_CACHE_BUDGET_KIB);
      expect(perConnection).toBeGreaterThanOrEqual(256);
    }
    // A small library keeps whole modules cached, a large one gets a share.
    expect(shelfCacheKiB(20)).toBeLessThan(shelfCacheKiB(774));
    expect(shelfCacheKiB(774)).toBeLessThan(0);
  });

  it('sizes the budget by the memory the device reports', () => {
    expect(shelfCacheBudgetKiB(undefined)).toBe(SHELF_CACHE_BUDGET_KIB);
    expect(shelfCacheBudgetKiB(Number.NaN)).toBe(SHELF_CACHE_BUDGET_KIB);
    expect(shelfCacheBudgetKiB(0.5)).toBe(96 * 1024);
    expect(shelfCacheBudgetKiB(4)).toBe(192 * 1024);
    expect(shelfCacheBudgetKiB(32)).toBe(384 * 1024);
    // The same library gets a smaller cache on a smaller phone.
    expect(shelfCacheKiB(300, shelfCacheBudgetKiB(2))).toBeGreaterThan(
      shelfCacheKiB(300, shelfCacheBudgetKiB(8)),
    );
  });
});

describe('ModuleShelf', () => {
  it('sends the calls of one turn as a single message and answers each caller', async () => {
    const { worker, requests } = fakeWorker();
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker });
    const stores = await Promise.all(
      ['a', 'b', 'c'].map((file) => shelf.open(file, 10, { cacheSizeKiB: -256 })),
    );
    const before = requests.length;
    const results = await Promise.all(stores.map((store) => store.getChunk('id')));
    expect(results).toEqual(['getChunk:a', 'getChunk:b', 'getChunk:c']);
    expect(requests.length - before).toBe(1);
    expect(requests.at(-1)).toMatchObject({ type: 'batch' });
  });

  it('opens a file once and closes it after its last lease', async () => {
    const { worker, requests } = fakeWorker();
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker });
    const first = await shelf.open('a', 10, { cacheSizeKiB: -256 });
    const second = await shelf.open('a', 10, { cacheSizeKiB: -256 });
    expect(requests.filter((request) => request.type === 'open')).toHaveLength(1);
    await first.close();
    expect(requests.some((request) => request.type === 'close')).toBe(false);
    await second.close();
    expect(requests.filter((request) => request.type === 'close')).toHaveLength(1);
    await expect(second.getChunk('x')).rejects.toThrow('closed');
  });

  it('passes the image to write and the page cache the caller chose', async () => {
    const { worker, requests } = fakeWorker();
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker });
    const bytes = new Uint8Array([1, 2, 3]);
    await shelf.open('a', 3, { bytes, cacheSizeKiB: -512 });
    expect(requests.find((request) => request.type === 'open')).toMatchObject({
      type: 'open',
      file: 'a',
      byteLength: 3,
      bytes,
      cacheSizeKiB: -512,
    });
  });

  it('asks a file for its health once, and again after it is seeded', async () => {
    const { worker, requests } = fakeWorker();
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker });
    const store = await shelf.open('a', 10, { cacheSizeKiB: -256 });
    const calls = () =>
      requests
        .filter((request) => request.type === 'batch')
        .flatMap((request) => (request.type === 'batch' ? request.calls : []))
        .filter((call) => call.method === 'getHealth').length;
    await store.getHealth();
    await store.getHealth();
    await store.getHealth();
    expect(calls()).toBe(1);
    await store.initialize({} as never);
    await store.getHealth();
    expect(calls()).toBe(2);
  });

  it('reads each whole-file listing once per open file, across leases', async () => {
    const { worker, requests } = fakeWorker();
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker });
    const first = await shelf.open('a', 10, { cacheSizeKiB: -256 });
    const second = await shelf.open('a', 10, { cacheSizeKiB: -256 });
    await first.listAliases();
    await second.listAliases();
    await second.listDocumentIdentities();
    const listed = requests
      .flatMap((request) => (request.type === 'batch' ? request.calls : []))
      .map((call) => call.method);
    expect(listed.filter((method) => method === 'listAliases')).toHaveLength(1);
    expect(listed.filter((method) => method === 'listDocumentIdentities')).toHaveLength(1);
  });

  it('fails one call of a batch without failing its neighbours', async () => {
    const { worker } = fakeWorker((request) =>
      request.type === 'batch'
        ? {
            id: request.id,
            result: [{ value: 'fine' }, { error: 'SQLITE_NOMEM: out of memory' }],
          }
        : undefined,
    );
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker });
    const [a, b] = await Promise.all([
      shelf.open('a', 10, { cacheSizeKiB: -256 }),
      shelf.open('b', 10, { cacheSizeKiB: -256 }),
    ]);
    const settled = await Promise.allSettled([a.getChunk('x'), b.getChunk('x')]);
    expect(settled[0]).toMatchObject({ status: 'fulfilled', value: 'fine' });
    expect(settled[1]).toMatchObject({ status: 'rejected' });
  });

  it('is unavailable after its worker failed to start, so modules stay in memory', async () => {
    const { worker } = fakeWorker((request) =>
      request.type === 'init' ? { id: request.id, error: 'No OPFS here.' } : undefined,
    );
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker });
    await expect(shelf.open('a', 10, { cacheSizeKiB: -256 })).rejects.toThrow('No OPFS here.');
    expect(shelf.unavailable).toBe(true);
    expect(worker.terminated).toBe(true);
    await expect(shelf.put('a', new Uint8Array(1))).rejects.toThrow('No OPFS here.');
  });

  it('writes, reads and sweeps files through the worker', async () => {
    const { worker, requests } = fakeWorker((request) => {
      if (request.type === 'read') return { id: request.id, result: new Uint8Array([9]) };
      if (request.type === 'sweep') return { id: request.id, result: 2 };
      return undefined;
    });
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker, idleShutdownMs: 0 });
    await shelf.put('a', new Uint8Array([1, 2]));
    expect(await shelf.read('a')).toEqual(new Uint8Array([9]));
    expect(await shelf.sweep(['x@1'])).toBe(2);
    expect(requests.find((request) => request.type === 'put')).toMatchObject({
      file: 'a',
      byteLength: 2,
    });
    expect(requests.find((request) => request.type === 'sweep')).toMatchObject({
      referencedVersionKeys: ['x@1'],
    });
  });

  it('stops its worker when no file is open and starts a new one for the next use', async () => {
    vi.useFakeTimers();
    try {
      const workers: ReturnType<typeof fakeWorker>[] = [];
      const shelf = new ModuleShelf({
        shardCount: 1,
        createWorker: () => {
          const created = fakeWorker();
          workers.push(created);
          return created.worker;
        },
        idleShutdownMs: 1_000,
      });
      const store = await shelf.open('a', 10, { cacheSizeKiB: -256 });
      expect(shelf.running).toBe(true);
      await store.close();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(workers[0]?.worker.terminated).toBe(true);
      expect(shelf.running).toBe(false);
      expect(shelf.unavailable).toBe(false);
      await shelf.put('b', new Uint8Array(1));
      expect(workers).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports another tab holding the pool', async () => {
    const waits: boolean[] = [];
    const { worker } = fakeWorker((request) => {
      if (request.type !== 'init') return undefined;
      worker.onmessage?.({ data: { id: request.id, status: 'lock-wait' } } as MessageEvent);
      worker.onmessage?.({ data: { id: request.id, status: 'lock-acquired' } } as MessageEvent);
      return { id: request.id, result: undefined };
    });
    const shelf = new ModuleShelf({ shardCount: 1, createWorker: () => worker });
    shelf.onWaitingForOtherTab((waiting) => waits.push(waiting));
    await shelf.open('a', 10, { cacheSizeKiB: -256 });
    expect(waits).toEqual([true, false]);
  });

  it('spreads files over the shards and asks each shard once per turn', async () => {
    const workers = [0, 1, 2].map(() => fakeWorker());
    const shelf = new ModuleShelf({
      shardCount: 3,
      createWorker: (shard) => (workers[shard] as ReturnType<typeof fakeWorker>).worker,
    });
    const files = Array.from({ length: 12 }, (_, index) => `module-${index}.db`);
    const stores = await Promise.all(
      files.map((file) => shelf.open(file, 10, { cacheSizeKiB: -256 })),
    );
    for (const file of files) {
      const opens = workers[shelfShardOf(file, 3)]?.requests.filter(
        (request) => request.type === 'open' && request.file === file,
      );
      expect(opens).toHaveLength(1);
    }
    const before = workers.map(({ requests }) => requests.length);
    const results = await Promise.all(stores.map((store) => store.getChunk('id')));
    expect(results).toEqual(files.map((file) => `getChunk:${file}`));
    workers.forEach(({ requests }, shard) => {
      const holdsFiles = files.some((file) => shelfShardOf(file, 3) === shard);
      expect(requests.length - (before[shard] ?? 0)).toBe(holdsFiles ? 1 : 0);
    });
    expect(workers.map(({ requests }) => requests[0])).toMatchObject(
      [0, 1, 2].map((shard) => ({ type: 'init', poolName: shelfPoolName(shard) })),
    );
  });

  it('moves a file an earlier app wrote into the single pool to its shard, once', async () => {
    const file = Array.from({ length: 20 }, (_, index) => `old-${index}.db`).find(
      (name) => shelfShardOf(name, 3) !== 0,
    ) as string;
    const home = shelfShardOf(file, 3);
    const image = new Uint8Array([4, 5, 6, 7]);
    const workers = [0, 1, 2].map((shard) =>
      fakeWorker((request) => {
        if (request.type === 'init') return { id: request.id, result: shard === 0 ? [file] : [] };
        if (request.type === 'read') return { id: request.id, result: image };
        return undefined;
      }),
    );
    const shelf = new ModuleShelf({
      shardCount: 3,
      createWorker: (shard) => (workers[shard] as ReturnType<typeof fakeWorker>).worker,
    });
    const [first, second] = await Promise.all([
      shelf.open(file, 4, { cacheSizeKiB: -256 }),
      shelf.open(file, 4, { cacheSizeKiB: -256 }),
    ]);
    const old = workers[0]?.requests ?? [];
    expect(old.filter((request) => request.type === 'read')).toHaveLength(1);
    expect(old.filter((request) => request.type === 'unlink')).toMatchObject([{ file }]);
    expect(workers[home]?.requests.filter((request) => request.type === 'open')).toMatchObject([
      { file, byteLength: 4, bytes: image },
    ]);
    await first?.close();
    await second?.close();
    await shelf.open(file, 4, { cacheSizeKiB: -256 });
    expect(old.filter((request) => request.type === 'read')).toHaveLength(1);
    expect(await shelf.read(file)).toEqual(image);
  });
});
