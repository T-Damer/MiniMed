import * as zlib from 'node:zlib';
import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import type { StorageHealth } from '@localmed/storage';
import {
  SQLITE_WASM_DESERIALIZE_MAX_BYTES,
  type SqliteIntegrityReport,
} from '@localmed/storage-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserModuleBackend,
  BrowserModuleValidator,
  loadInstalledModuleMounts,
  migrateInactiveModuleCopies,
  sweepOrphanedModulePools,
} from '@/features/modules/browser-module-runtime';
import { moduleOpfsPoolName } from '@/features/modules/module-opfs-pools';

const SHA = `sha256:${'a'.repeat(64)}`;
const OTHER_SHA = `sha256:${'b'.repeat(64)}`;
const LARGE = SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1;
const HEALTH: StorageHealth = {
  schemaVersion: 2,
  sqliteVersion: 'test',
  fts5Available: true,
  contentPackIds: ['pack'],
  documentCount: 1,
  backend: 'sqlite-wasm',
  persistent: true,
  installation: 'reused',
  sizeBytes: LARGE,
};
const INTEGRITY: SqliteIntegrityReport = {
  integrity: 'ok',
  foreignKeyViolations: 0,
  chunkCount: 1,
  ftsRowCount: 1,
  embeddingProfileCount: 0,
  embeddingCount: 0,
};

type Row = Record<string, unknown> & { key: string; moduleId: string; version: string };
interface OpenRequest {
  readonly id: number;
  readonly type: 'open';
  readonly databaseName: string;
  readonly poolName: string;
  readonly url?: string;
  readonly installed?: { readonly byteLength: number };
  readonly encoded?: { readonly bytes: Uint8Array; readonly decodedSizeBytes: number };
}

interface World {
  readonly rows: Map<string, Row>;
  readonly active: Map<string, { moduleId: string; version: string }>;
  readonly opens: OpenRequest[];
  readonly pools: Set<string>;
  readonly busyPools: Set<string>;
  failOpen: boolean;
}

function request<T>(result: T): IDBRequest<T> {
  const value = { result, onsuccess: null as (() => void) | null, onerror: null };
  queueMicrotask(() => value.onsuccess?.());
  return value as unknown as IDBRequest<T>;
}

function installWorld(): World {
  const world: World = {
    rows: new Map(),
    active: new Map(),
    opens: [],
    pools: new Set(),
    busyPools: new Set(),
    failOpen: false,
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: (storeNames: string | readonly string[]) => {
      const transaction = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        abort: () => {
          setTimeout(() => transaction.onabort?.(), 0);
        },
        objectStore: (requested?: string) => {
          const name = requested ?? (typeof storeNames === 'string' ? storeNames : '');
          const done = <T>(result: T) => {
            setTimeout(() => transaction.oncomplete?.(), 0);
            return request(result);
          };
          if (name === 'active') {
            return {
              getAll: () => done([...world.active.values()]),
              get: (key: string) => done(world.active.get(key)),
              put: (value: { moduleId: string; version: string }) => {
                world.active.set(value.moduleId, { ...value });
                return done(value);
              },
              delete: (key: string) => {
                world.active.delete(key);
                return done(undefined);
              },
            };
          }
          return {
            get: (key: string) => done(world.rows.get(key)),
            getAllKeys: () => done([...world.rows.keys()]),
            put: (value: Row) => {
              world.rows.set(value.key, { ...value });
              return done(value);
            },
            delete: (key: string) => {
              world.rows.delete(key);
              return done(undefined);
            },
          };
        },
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  vi.stubGlobal('indexedDB', {
    open: () => {
      const value = {
        result: database,
        onsuccess: null as (() => void) | null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => value.onsuccess?.());
      return value as unknown as IDBOpenDBRequest;
    },
  });

  vi.stubGlobal(
    'Worker',
    vi.fn(function FakeWorker(this: {
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: (() => void) | null;
      terminate: () => void;
      postMessage: (message: OpenRequest | { id: number; method: string }) => void;
    }) {
      this.onmessage = null;
      this.onerror = null;
      this.terminate = vi.fn();
      this.postMessage = (message) => {
        queueMicrotask(() => {
          if ('type' in message && message.type === 'open') {
            world.opens.push(message);
            if (world.failOpen) {
              this.onmessage?.({
                data: { id: message.id, error: 'decoded checksum mismatch' },
              } as MessageEvent);
              return;
            }
            // An open that imports (url/encoded) leaves its pool behind, as the SAH pool does.
            if (!message.installed) world.pools.add(message.poolName);
          }
          const method = 'method' in message ? message.method : 'open';
          const result =
            method === 'open' || method === 'initialize'
              ? HEALTH
              : method === 'inspectIntegrity'
                ? INTEGRITY
                : undefined;
          this.onmessage?.({ data: { id: message.id, result } } as MessageEvent);
        });
      };
    }),
  );
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:module');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        name: string,
        options: { ifAvailable?: boolean },
        callback: (lock: unknown) => Promise<unknown>,
      ) => {
        const pool = name.startsWith('minimed-opfs:') ? name.slice('minimed-opfs:'.length) : null;
        if (pool && world.busyPools.has(pool)) return callback(null);
        void options;
        return callback({ name });
      },
    },
    storage: {
      getDirectory: async () => ({
        keys: async function* () {
          for (const pool of world.pools) yield `.${pool}`;
          yield '.minimed-sah-core';
        },
        removeEntry: async (name: string) => {
          if (!world.pools.delete(name.slice(1))) throw new DOMException('x', 'NotFoundError');
        },
      }),
    },
  });
  return world;
}

function row(moduleId: string, version: string, extra: Record<string, unknown> = {}): Row {
  return {
    key: `${moduleId}@${version}`,
    moduleId,
    version,
    sourceSetDigest: SHA,
    installedAt: '2026-09-01T00:00:00.000Z',
    indexSha256: SHA,
    ...extra,
  };
}

function seed(world: World, ...rows: Row[]): void {
  for (const entry of rows) world.rows.set(entry.key, entry);
}

function moduleEntry(id: string, version = '1.0.0'): ContentModuleCatalogEntry {
  return {
    id,
    version,
    kind: 'medication',
    collection: 'esklp',
    title: 'Test',
    description: 'Test',
    required: false,
    releaseState: 'published',
    specialties: [],
    populations: [],
    tags: [],
    compatibility: {
      minAppVersion: '0.1.0',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: SHA,
    dependencies: [],
    sizes: {
      downloadBytes: 10,
      installedBytes: LARGE,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
    },
    capabilities: {
      search: true,
      fullText: true,
      structuredTables: false,
      images: false,
      originalPdf: false,
      structuredKnowledge: false,
      calculations: false,
    },
    artifacts: [
      {
        id: 'index',
        kind: 'index',
        required: true,
        url: 'https://example.test/index.db.zst',
        sha256: OTHER_SHA,
        sizeBytes: 10,
        compression: 'zstd',
        decodedSha256: SHA,
        decodedSizeBytes: LARGE,
        sourceSetDigest: SHA,
      },
    ],
    documents: [],
    previewDocumentCount: 1,
  };
}

const zstdCompressSync = (zlib as { zstdCompressSync?: typeof zlib.zstdCompressSync })
  .zstdCompressSync;
function framedArchive(): Uint8Array {
  const content = new TextEncoder().encode('SQLite format 3\0'.repeat(50));
  const options = { pledgedSrcSize: content.length } as unknown as zlib.ZstdOptions;
  return (zstdCompressSync as typeof zlib.zstdCompressSync)(content, options);
}

let world: World;
beforeEach(() => {
  world = installWorld();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('single store for large module indexes', () => {
  it('mounts a row that exists only in OPFS by opening the installed file, never importing', async () => {
    seed(world, row('minimed.esklp.a', '1.0.0', { indexStorage: 'opfs', indexSizeBytes: LARGE }));
    world.active.set('minimed.esklp.a', { moduleId: 'minimed.esklp.a', version: '1.0.0' });

    const mounts = await loadInstalledModuleMounts();
    expect(mounts).toHaveLength(1);
    expect(world.opens).toHaveLength(1);
    expect(world.opens[0]).toMatchObject({
      installed: { byteLength: LARGE },
      poolName: moduleOpfsPoolName('minimed.esklp.a', '1.0.0', SHA),
    });
    expect(world.opens[0]?.url).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await Promise.all(mounts.map((mount) => mount.store.close()));
  });

  it('migrates an install that kept both copies: the OPFS copy stays, the IndexedDB bytes go', async () => {
    seed(
      world,
      row('minimed.esklp.a', '1.0.0', { bytes: new ArrayBuffer(LARGE) }),
      row('minimed.small', '1.0.0', { bytes: new ArrayBuffer(10) }),
    );
    world.active.set('minimed.esklp.a', { moduleId: 'minimed.esklp.a', version: '1.0.0' });

    const mounts = await loadInstalledModuleMounts();
    await Promise.all(mounts.map((mount) => mount.store.close()));

    const migrated = world.rows.get('minimed.esklp.a@1.0.0');
    expect(migrated?.['bytes']).toBeUndefined();
    expect(migrated).toMatchObject({
      indexStorage: 'opfs',
      indexSizeBytes: LARGE,
      indexSha256: SHA,
    });
    expect(world.rows.get('minimed.small@1.0.0')?.['bytes']).toBeInstanceOf(ArrayBuffer);

    // After the migration a reconnect opens the installed file and needs no payload at all.
    world.opens.length = 0;
    const again = await loadInstalledModuleMounts();
    expect(world.opens[0]?.installed).toEqual({ byteLength: LARGE });
    await Promise.all(again.map((mount) => mount.store.close()));
  });

  it('leaves the IndexedDB bytes alone when the mount fails', async () => {
    seed(world, row('minimed.esklp.a', '1.0.0', { bytes: new ArrayBuffer(LARGE) }));
    world.active.set('minimed.esklp.a', { moduleId: 'minimed.esklp.a', version: '1.0.0' });
    world.failOpen = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await loadInstalledModuleMounts()).toHaveLength(0);
    expect(world.rows.get('minimed.esklp.a@1.0.0')?.['bytes']).toBeInstanceOf(ArrayBuffer);
    expect(warn).toHaveBeenCalled();
  });

  it('migrates inactive versions that no mount will ever open', async () => {
    seed(
      world,
      row('minimed.esklp.a', '1.0.0', { bytes: new ArrayBuffer(LARGE) }),
      row('minimed.esklp.a', '1.1.0', { bytes: new ArrayBuffer(LARGE), indexSha256: OTHER_SHA }),
      row('minimed.other', '1.0.0', { bytes: new ArrayBuffer(LARGE) }),
    );
    world.active.set('minimed.esklp.a', { moduleId: 'minimed.esklp.a', version: '1.1.0' });

    const migrated = await migrateInactiveModuleCopies(new Set(['minimed.esklp.a']));
    expect(migrated).toBe(1);
    expect(world.rows.get('minimed.esklp.a@1.0.0')?.['bytes']).toBeUndefined();
    expect(world.rows.get('minimed.esklp.a@1.0.0')?.['indexStorage']).toBe('opfs');
    // The active version is the mount's business; a module outside the large set is not scanned.
    expect(world.rows.get('minimed.esklp.a@1.1.0')?.['bytes']).toBeInstanceOf(ArrayBuffer);
    expect(world.rows.get('minimed.other@1.0.0')?.['bytes']).toBeInstanceOf(ArrayBuffer);
    expect(world.pools.has(moduleOpfsPoolName('minimed.esklp.a', '1.0.0', SHA))).toBe(true);
  });

  it('activates a large decoded index without storing its bytes in IndexedDB', async () => {
    const backend = new BrowserModuleBackend();
    const module = moduleEntry('minimed.esklp.a');
    const artifact = {
      ...(module.artifacts[0] as ContentModuleCatalogEntry['artifacts'][number]),
      compression: 'none' as const,
      sha256: SHA,
    };
    const staged = await backend.stage(module, artifact, new Uint8Array(LARGE));
    const receipt = await backend.activate(module, [staged]);

    const stored = world.rows.get('minimed.esklp.a@1.0.0');
    expect(stored?.['bytes']).toBeUndefined();
    expect(stored).toMatchObject({ indexStorage: 'opfs', indexSizeBytes: LARGE, indexSha256: SHA });
    expect(receipt.installedSizeBytes).toBe(LARGE);
    expect(world.pools.has(moduleOpfsPoolName('minimed.esklp.a', '1.0.0', SHA))).toBe(true);
    expect(await backend.readIndexBytes('minimed.esklp.a', '1.0.0')).toBeNull();
  });

  it('keeps a small index in IndexedDB and out of OPFS', async () => {
    const backend = new BrowserModuleBackend();
    const module = moduleEntry('minimed.small');
    const artifact = {
      ...(module.artifacts[0] as ContentModuleCatalogEntry['artifacts'][number]),
      compression: 'none' as const,
      sha256: SHA,
    };
    const staged = await backend.stage(module, artifact, new Uint8Array([1, 2, 3]));
    await backend.activate(module, [staged]);
    expect(world.rows.get('minimed.small@1.0.0')?.['bytes']).toBeInstanceOf(Blob);
    expect(world.pools.size).toBe(0);
    expect(await backend.readIndexBytes('minimed.small', '1.0.0')).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});

describe.skipIf(typeof zstdCompressSync !== 'function')('streamed zstd install', () => {
  const signal = new AbortController().signal;

  it('decodes into OPFS in the worker, validates that copy and stores no bytes', async () => {
    const backend = new BrowserModuleBackend();
    const module = moduleEntry('minimed.esklp.a');
    const artifact = module.artifacts[0] as ContentModuleCatalogEntry['artifacts'][number];
    const archive = framedArchive();

    const staged = await backend.stageEncodedIndex(module, artifact, archive, signal);
    expect(staged).toMatchObject({ artifactId: 'index', sizeBytes: LARGE });
    expect(world.opens).toHaveLength(1);
    expect(world.opens[0]?.encoded?.decodedSizeBytes).toBe(LARGE);
    expect(world.opens[0]?.encoded?.bytes).toEqual(archive);
    expect(world.opens[0]?.url).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    const validation = await new BrowserModuleValidator().validate(module, null);
    expect(validation).toMatchObject({ valid: true, sqliteIntegrity: 'ok' });
    expect(world.opens[1]?.installed).toEqual({ byteLength: LARGE });

    if (!staged) throw new Error('expected a staged index');
    const receipt = await backend.activate(module, [staged]);
    expect(receipt.installedSizeBytes).toBe(LARGE);
    expect(world.rows.get('minimed.esklp.a@1.0.0')).toMatchObject({
      indexStorage: 'opfs',
      indexSizeBytes: LARGE,
      indexSha256: SHA,
    });
    expect(world.rows.get('minimed.esklp.a@1.0.0')?.['bytes']).toBeUndefined();
    expect(world.pools.has(moduleOpfsPoolName('minimed.esklp.a', '1.0.0', SHA))).toBe(true);
  });

  it('declines what it cannot stream so the generic path runs', async () => {
    const backend = new BrowserModuleBackend();
    const module = moduleEntry('minimed.esklp.a');
    const artifact = module.artifacts[0] as ContentModuleCatalogEntry['artifacts'][number];
    const archive = framedArchive();
    expect(
      await backend.stageEncodedIndex(
        module,
        { ...artifact, decodedSizeBytes: 1000 },
        archive,
        signal,
      ),
    ).toBeNull();
    expect(
      await backend.stageEncodedIndex(
        module,
        { ...artifact, compression: 'gzip' },
        archive,
        signal,
      ),
    ).toBeNull();
    expect(
      await backend.stageEncodedIndex(module, artifact, new Uint8Array([1, 2, 3, 4]), signal),
    ).toBeNull();
    expect(world.opens).toHaveLength(0);
  });

  it('removes the pool of a failed install, but never one an installed version is using', async () => {
    const backend = new BrowserModuleBackend();
    const module = moduleEntry('minimed.esklp.a');
    const artifact = module.artifacts[0] as ContentModuleCatalogEntry['artifacts'][number];
    const pool = moduleOpfsPoolName('minimed.esklp.a', '1.0.0', SHA);

    const staged = await backend.stageEncodedIndex(module, artifact, framedArchive(), signal);
    expect(world.pools.has(pool)).toBe(true);
    expect(staged).not.toBeNull();
    await backend.discardStaging('minimed.esklp.a', '1.0.0');
    expect(world.pools.has(pool)).toBe(false);

    seed(world, row('minimed.esklp.a', '1.0.0', { indexStorage: 'opfs', indexSizeBytes: LARGE }));
    await backend.stageEncodedIndex(module, artifact, framedArchive(), signal);
    await backend.discardStaging('minimed.esklp.a', '1.0.0');
    expect(world.pools.has(pool)).toBe(true);
  });

  it('removes the pool and reports the error when decoding or verification fails', async () => {
    const backend = new BrowserModuleBackend();
    const module = moduleEntry('minimed.esklp.a');
    const artifact = module.artifacts[0] as ContentModuleCatalogEntry['artifacts'][number];
    world.failOpen = true;
    await expect(
      backend.stageEncodedIndex(module, artifact, framedArchive(), signal),
    ).rejects.toThrow('decoded checksum mismatch');
    expect(world.pools.size).toBe(0);
    expect(world.rows.size).toBe(0);
  });
});

describe('OPFS pool cleanup', () => {
  const poolA = moduleOpfsPoolName('minimed.esklp.a', '1.0.0', SHA);
  const poolB = moduleOpfsPoolName('minimed.esklp.b', '1.0.0', SHA);
  const orphan = moduleOpfsPoolName('minimed.gone', '9.9.9', SHA);

  it('remove deletes the module rows and every pool no row refers to any more', async () => {
    seed(
      world,
      row('minimed.esklp.a', '1.0.0', { indexStorage: 'opfs', indexSizeBytes: LARGE }),
      row('minimed.esklp.b', '1.0.0', { indexStorage: 'opfs', indexSizeBytes: LARGE }),
    );
    for (const pool of [poolA, poolB, orphan]) world.pools.add(pool);

    await new BrowserModuleBackend().remove('minimed.esklp.a');

    expect(world.rows.has('minimed.esklp.a@1.0.0')).toBe(false);
    expect([...world.pools].sort()).toEqual([poolB]);
  });

  it('leaves a pool a live worker still holds for a later sweep', async () => {
    seed(world, row('minimed.esklp.b', '1.0.0', { indexStorage: 'opfs', indexSizeBytes: LARGE }));
    for (const pool of [poolB, orphan]) world.pools.add(pool);
    world.busyPools.add(orphan);

    expect(await sweepOrphanedModulePools()).toMatchObject({ removed: [], busy: [orphan] });
    expect(world.pools.has(orphan)).toBe(true);
    world.busyPools.clear();
    expect(await sweepOrphanedModulePools()).toMatchObject({ removed: [orphan] });
    expect([...world.pools]).toEqual([poolB]);
  });

  it('keeps pools of every stored version, including the inactive ones kept for rollback', async () => {
    seed(
      world,
      row('minimed.esklp.a', '1.0.0', { indexStorage: 'opfs', indexSizeBytes: LARGE }),
      row('minimed.esklp.a', '1.0.10', { indexStorage: 'opfs', indexSizeBytes: LARGE }),
    );
    const older = poolA;
    const newer = moduleOpfsPoolName('minimed.esklp.a', '1.0.10', OTHER_SHA);
    const unrelated = moduleOpfsPoolName('minimed.esklp.a', '1.0.1', SHA);
    for (const pool of [older, newer, unrelated]) world.pools.add(pool);

    await sweepOrphanedModulePools();
    expect([...world.pools].sort()).toEqual([newer, older].sort());
  });
});
