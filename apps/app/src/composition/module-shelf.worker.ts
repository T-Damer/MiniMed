/// <reference lib="webworker" />

import {
  listOpfsPoolFiles,
  type OpfsPackSource,
  readOpfsPoolFile,
  SqliteMedicalStore,
  sqliteWasmHeapBytes,
  unlinkOpfsPoolFiles,
} from '@localmed/storage-sqlite';

import {
  isOrphanedShelfFile,
  SHELF_POOL_GROWTH_STEP,
  SHELF_VERIFY_CACHE_KIB,
} from '@/composition/module-shelf-names';
import type {
  ShelfCall,
  ShelfCallOutcome,
  ShelfRequest,
  ShelfResponse,
} from '@/composition/module-shelf-protocol';

/**
 * The module shelf: every small installed module is a file of one SAH pool, opened here as one
 * SQLite connection. The wasm heap of this worker holds connections and bounded page caches, not
 * database images, so installing more modules does not exhaust it (the 2 GB heap of the main
 * thread did, at about 800 modules).
 */

let poolName: string | undefined;
const stores = new Map<string, SqliteMedicalStore>();
/** Imports and sweeps change the pool's file table; one at a time. */
let writeQueue: Promise<unknown> = Promise.resolve();

function reply(response: ShelfResponse): void {
  self.postMessage(response);
}

function inWriteQueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => undefined);
  return next;
}

function requirePool(): string {
  if (!poolName) throw new Error('The module shelf is not initialised.');
  return poolName;
}

function imageSource(bytes: Uint8Array, byteLength: number): OpfsPackSource {
  if (bytes.byteLength !== byteLength) {
    throw new Error(`Module image has ${bytes.byteLength} bytes instead of ${byteLength}.`);
  }
  return {
    kind: 'stream',
    byteLength,
    open: () => {
      let sent = false;
      return async () => {
        if (sent) return undefined;
        sent = true;
        return bytes;
      };
    },
  };
}

/**
 * The browser lock a pool's owner holds for its lifetime (the module pool sweeps and a reload
 * read it). Another tab can hold it indefinitely, so the wait is reported, never timed out.
 */
async function holdPoolLock(id: number, name: string): Promise<void> {
  const lockName = `minimed-opfs:${name}`;
  const holdLock = (lock: Lock | null, resolve: (held: boolean) => void) =>
    new Promise<void>(() => resolve(lock !== null));
  const acquiredImmediately = await new Promise<boolean>((resolve, reject) => {
    void navigator.locks
      .request(lockName, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve(false);
          return undefined;
        }
        return holdLock(lock, resolve);
      })
      .catch(reject);
  });
  if (acquiredImmediately) return;
  reply({ id, status: 'lock-wait' });
  await new Promise<boolean>((resolve, reject) => {
    void navigator.locks.request(lockName, (lock) => holdLock(lock, resolve)).catch(reject);
  });
}

async function callStore(call: ShelfCall): Promise<unknown> {
  const store = stores.get(call.file);
  if (!store) throw new Error('The module is not open on the shelf.');
  const method = store[call.method].bind(store) as (
    ...args: readonly unknown[]
  ) => Promise<unknown>;
  return method(...call.args);
}

async function handle(message: ShelfRequest): Promise<unknown> {
  switch (message.type) {
    case 'init': {
      if (poolName) return undefined;
      await holdPoolLock(message.id, message.poolName);
      poolName = message.poolName;
      reply({ id: message.id, status: 'lock-acquired' });
      // Opening the pool reads its file table; later opens reuse it.
      await listOpfsPoolFiles(poolName);
      return undefined;
    }
    case 'open': {
      const pool = requirePool();
      if (stores.has(message.file)) return undefined;
      const source: OpfsPackSource = message.bytes
        ? imageSource(message.bytes, message.byteLength)
        : { kind: 'installed', byteLength: message.byteLength };
      const store = await inWriteQueue(() =>
        SqliteMedicalStore.createFromOpfsSource(source, message.file, {
          poolName: pool,
          cacheSizeKiB: message.cacheSizeKiB,
          poolGrowthStep: SHELF_POOL_GROWTH_STEP,
          disableLookaside: true,
        }),
      );
      stores.set(message.file, store);
      return undefined;
    }
    case 'put': {
      const pool = requirePool();
      if (stores.has(message.file)) return undefined;
      // Written and opened once, so a database that cannot be opened is never left on the shelf;
      // the connection is not kept, the module is mounted by the next core.
      const store = await inWriteQueue(() =>
        SqliteMedicalStore.createFromOpfsSource(
          imageSource(message.bytes, message.byteLength),
          message.file,
          {
            poolName: pool,
            cacheSizeKiB: SHELF_VERIFY_CACHE_KIB,
            poolGrowthStep: SHELF_POOL_GROWTH_STEP,
            disableLookaside: true,
          },
        ),
      );
      await store.close();
      return undefined;
    }
    case 'read': {
      const bytes = await readOpfsPoolFile(requirePool(), `/${message.file}`);
      return bytes;
    }
    case 'stats':
      return { openFiles: stores.size, heapBytes: await sqliteWasmHeapBytes() };
    case 'batch': {
      const outcomes: ShelfCallOutcome[] = [];
      for (const call of message.calls) {
        try {
          outcomes.push({ value: await callStore(call) });
        } catch (cause) {
          outcomes.push({
            error: cause instanceof Error ? cause.message : 'The module store call failed.',
          });
        }
      }
      return outcomes;
    }
    case 'close': {
      const store = stores.get(message.file);
      stores.delete(message.file);
      await store?.close();
      return undefined;
    }
    case 'sweep': {
      const pool = requirePool();
      const referenced = new Set(message.referencedVersionKeys);
      return inWriteQueue(async () => {
        const orphans = (await listOpfsPoolFiles(pool)).filter(
          (name) => isOrphanedShelfFile(name, referenced) && !stores.has(name.slice(1)),
        );
        return unlinkOpfsPoolFiles(pool, orphans);
      });
    }
  }
}

self.onmessage = async (event: MessageEvent<ShelfRequest>): Promise<void> => {
  const message = event.data;
  try {
    const result = await handle(message);
    reply({ id: message.id, result });
  } catch (cause) {
    reply({
      id: message.id,
      error: cause instanceof Error ? cause.message : 'The module shelf failed.',
    });
  }
};
