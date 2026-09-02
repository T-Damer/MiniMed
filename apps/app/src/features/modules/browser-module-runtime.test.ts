import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import type { StorageHealth } from '@localmed/storage';
import { InMemoryInstalledModuleRegistry } from '@localmed/storage';
import {
  SQLITE_WASM_DESERIALIZE_MAX_BYTES,
  type SqliteIntegrityReport,
  SqliteMedicalStore,
} from '@localmed/storage-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserModuleBackend,
  BrowserModuleValidator,
  ensureBundledCore,
  loadInstalledModuleMounts,
  readActiveInstalledSourceAssets,
} from '@/features/modules/browser-module-runtime';

const CHECKSUM = `sha256:${'a'.repeat(64)}`;
const ACTIVE_STORE = 'active';
const HEALTH: StorageHealth = {
  schemaVersion: 2,
  sqliteVersion: 'test',
  fts5Available: true,
  contentPackIds: ['pack'],
  documentCount: 1,
  backend: 'sqlite-wasm',
  persistent: true,
  installation: 'reused',
  sizeBytes: SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1,
};
const INTEGRITY: SqliteIntegrityReport = {
  integrity: 'ok',
  foreignKeyViolations: 0,
  chunkCount: 1,
  ftsRowCount: 1,
  embeddingProfileCount: 0,
  embeddingCount: 0,
};

type WorkerRequest =
  | {
      readonly id: number;
      readonly type: 'open';
      readonly databaseName: string;
      readonly poolName: string;
    }
  | { readonly id: number; readonly type: 'call'; readonly method: string };
type OpenWorkerRequest = Extract<WorkerRequest, { readonly type: 'open' }>;

type WorkerDouble = {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
};

function installWorkerDouble(): WorkerDouble[] {
  const workers: WorkerDouble[] = [];
  vi.stubGlobal(
    'Worker',
    vi.fn(function FakeWorker(this: WorkerDouble) {
      this.onmessage = null;
      this.onerror = null;
      this.terminate = vi.fn();
      this.postMessage = vi.fn((message: WorkerRequest) => {
        queueMicrotask(() => {
          const result =
            message.type === 'open' || message.method === 'initialize'
              ? HEALTH
              : message.method === 'inspectIntegrity'
                ? INTEGRITY
                : undefined;
          this.onmessage?.({ data: { id: message.id, result } } as MessageEvent);
        });
      });
      workers.push(this);
    }),
  );
  return workers;
}

function installObjectUrlDouble(): void {
  let nextId = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:module-${++nextId}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}

function moduleEntry(id = 'minimed.test.module', version = '1.0.0'): ContentModuleCatalogEntry {
  return {
    id,
    version,
    kind: 'clinical',
    collection: 'test',
    title: 'Test module',
    description: 'Test module',
    required: false,
    releaseState: 'published',
    specialties: [],
    populations: ['all'],
    tags: [],
    compatibility: {
      minAppVersion: '0.1.0',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: CHECKSUM,
    dependencies: [],
    sizes: {
      downloadBytes: SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1,
      installedBytes: SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1,
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
    artifacts: [],
    documents: [],
    previewDocumentCount: 1,
  };
}

function installModuleDatabase(
  pointers: readonly { readonly moduleId: string; readonly version: string }[],
  bytes: ArrayBuffer,
): void {
  const versions = new Map(
    pointers.map((pointer) => [
      `${pointer.moduleId}@${pointer.version}`,
      {
        key: `${pointer.moduleId}@${pointer.version}`,
        ...pointer,
        bytes,
        sourceSetDigest: CHECKSUM,
        installedAt: '2026-09-01T00:00:00.000Z',
      },
    ]),
  );

  const requestWithResult = <T>(result: T): IDBRequest<T> => {
    const request = {
      result,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    queueMicrotask(() => request.onsuccess?.());
    return request as unknown as IDBRequest<T>;
  };

  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: (_storeName: string) => {
      const transaction = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => ({
          getAll: () => {
            const request = requestWithResult(pointers);
            setTimeout(() => transaction.oncomplete?.(), 0);
            return request;
          },
          get: (key: string) => {
            const request = requestWithResult(versions.get(key));
            setTimeout(() => transaction.oncomplete?.(), 0);
            return request;
          },
        }),
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;

  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = {
        result: database,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request as unknown as IDBOpenDBRequest;
    },
  });
}

function installWritableModuleDatabase(): void {
  const versions = new Map<string, Record<string, unknown>>();
  const active = new Map<string, { readonly moduleId: string; readonly version: string }>();

  const requestWithResult = <T>(result: T): IDBRequest<T> => {
    const request = {
      result,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    queueMicrotask(() => request.onsuccess?.());
    return request as unknown as IDBRequest<T>;
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
        objectStore: (requestedStoreName?: string) => {
          const storeName =
            requestedStoreName ?? (typeof storeNames === 'string' ? storeNames : '');
          if (storeName === ACTIVE_STORE) {
            return {
              getAll: () => {
                const request = requestWithResult([...active.values()]);
                setTimeout(() => transaction.oncomplete?.(), 0);
                return request;
              },
              get: (key: string) => {
                const request = requestWithResult(active.get(key));
                setTimeout(() => transaction.oncomplete?.(), 0);
                return request;
              },
              put: (value: { readonly moduleId: string; readonly version: string }) => {
                active.set(value.moduleId, { ...value });
                setTimeout(() => transaction.oncomplete?.(), 0);
                return requestWithResult(value);
              },
              delete: (key: string) => {
                active.delete(key);
                setTimeout(() => transaction.oncomplete?.(), 0);
                return requestWithResult(undefined);
              },
            };
          }
          return {
            get: (key: string) => {
              const request = requestWithResult(versions.get(key));
              setTimeout(() => transaction.oncomplete?.(), 0);
              return request;
            },
            getAllKeys: () => {
              const request = requestWithResult([...versions.keys()]);
              setTimeout(() => transaction.oncomplete?.(), 0);
              return request;
            },
            put: (value: Record<string, unknown>) => {
              versions.set(String(value['key']), { ...value });
              setTimeout(() => transaction.oncomplete?.(), 0);
              return requestWithResult(value);
            },
            delete: (key: string) => {
              versions.delete(key);
              setTimeout(() => transaction.oncomplete?.(), 0);
              return requestWithResult(undefined);
            },
          };
        },
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;

  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = {
        result: database,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request as unknown as IDBOpenDBRequest;
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser module runtime storage', () => {
  it('refreshes a stale bundled core while preserving its installedAt', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate({
      moduleId: 'minimed.core.ru',
      version: '1.0.0-preview.1',
      required: true,
      installedAt: '2026-08-01T00:00:00.000Z',
      installedSizeBytes: 720 * 1024,
      sourceSetDigest: `sha256:${'a'.repeat(64)}`,
      validation: {
        checkedAt: '2026-08-01T00:00:00.000Z',
        valid: true,
        checksumValid: true,
        schemaCompatible: true,
        sqliteIntegrity: 'ok',
        message: 'old core',
      },
    });

    ensureBundledCore(registry, '2026-09-01T00:00:00.000Z');

    expect(registry.get('minimed.core.ru')).toMatchObject({
      version: '1.0.0-preview.3',
      installedAt: '2026-08-01T00:00:00.000Z',
      installedSizeBytes: 97_431_552,
      activeSourceSetDigest:
        'sha256:fb6b81dc769d23148170f990177b23a693e65ca31850817d3984df7d6d042508',
    });
  });

  it('does not rewrite an already current bundled core', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate({
      moduleId: 'minimed.core.ru',
      version: '1.0.0-preview.3',
      required: true,
      installedAt: '2026-08-01T00:00:00.000Z',
      installedSizeBytes: 97_431_552,
      sourceSetDigest: 'sha256:fb6b81dc769d23148170f990177b23a693e65ca31850817d3984df7d6d042508',
      validation: {
        checkedAt: '2026-08-01T00:00:00.000Z',
        valid: true,
        checksumValid: true,
        schemaCompatible: true,
        sqliteIntegrity: 'ok',
        message: 'current core',
      },
    });
    const before = registry.snapshot();

    ensureBundledCore(registry, '2026-09-01T00:00:00.000Z');

    expect(registry.snapshot()).toEqual(before);
  });

  it('stores source-assets with the active index and removes both together', async () => {
    installWritableModuleDatabase();
    const backend = new BrowserModuleBackend();
    const module = {
      ...moduleEntry(),
      artifacts: [
        {
          id: 'index',
          kind: 'index' as const,
          required: true,
          url: 'https://example.test/index.db',
          sha256: CHECKSUM,
          sizeBytes: 3,
          compression: 'none' as const,
          sourceSetDigest: CHECKSUM,
        },
        {
          id: 'sources',
          kind: 'source-assets' as const,
          required: true,
          url: 'https://example.test/sources.zip',
          sha256: CHECKSUM,
          sizeBytes: 2,
          compression: 'zip' as const,
          sourceSetDigest: CHECKSUM,
        },
      ],
    } satisfies ContentModuleCatalogEntry;
    const indexArtifact = module.artifacts[0];
    const sourceAssetsArtifact = module.artifacts[1];
    if (!indexArtifact || !sourceAssetsArtifact) throw new Error('expected module artifacts');
    const index = await backend.stage(module, indexArtifact, new Uint8Array([1, 2, 3]));
    const sourceAssets = await backend.stage(module, sourceAssetsArtifact, new Uint8Array([4, 5]));

    const receipt = await backend.activate(module, [index, sourceAssets]);

    expect(receipt.installedSizeBytes).toBe(5);
    expect(await readActiveInstalledSourceAssets(module.id)).toEqual(new Uint8Array([4, 5]));
    expect(await readActiveInstalledSourceAssets(module.id, 'sources')).toEqual(
      new Uint8Array([4, 5]),
    );
    await backend.remove(module.id);
    expect(await readActiveInstalledSourceAssets(module.id)).toBeNull();
  });

  it('returns null for an old installed record without source-assets', async () => {
    installModuleDatabase(
      [{ moduleId: 'minimed.old.module', version: '1.0.0' }],
      new Uint8Array([1]).buffer,
    );

    await expect(readActiveInstalledSourceAssets('minimed.old.module')).resolves.toBeNull();
    await expect(readActiveInstalledSourceAssets('minimed.missing.module')).resolves.toBeNull();
  });

  it('mounts oversized modules through OPFS and reuses the stable identity on reconnect', async () => {
    installObjectUrlDouble();
    const workers = installWorkerDouble();
    const pointer = { moduleId: 'minimed.esklp.ru', version: '1.0.0' };
    installModuleDatabase([pointer], new ArrayBuffer(SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1));

    const firstMounts = await loadInstalledModuleMounts();
    try {
      expect(firstMounts).toHaveLength(1);
      expect(workers).toHaveLength(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:module-1');
    } finally {
      await Promise.all(firstMounts.map((mount) => mount.store.close()));
    }

    const secondMounts = await loadInstalledModuleMounts();
    try {
      expect(secondMounts).toHaveLength(1);
      expect(workers).toHaveLength(2);
      const firstOpen = workers[0]?.postMessage.mock.calls[0]?.[0] as OpenWorkerRequest;
      const secondOpen = workers[1]?.postMessage.mock.calls[0]?.[0] as OpenWorkerRequest;
      expect(secondOpen).toMatchObject({
        type: 'open',
        databaseName: firstOpen.databaseName,
        poolName: firstOpen.poolName,
      });
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:module-2');
    } finally {
      await Promise.all(secondMounts.map((mount) => mount.store.close()));
    }
  });

  it('gives different module versions different OPFS pool/database keys', async () => {
    installObjectUrlDouble();
    const workers = installWorkerDouble();
    const pointers = [
      { moduleId: 'minimed.esklp.ru', version: '1.0.0' },
      { moduleId: 'minimed.esklp.ru', version: '1.0.1' },
    ];
    installModuleDatabase(pointers, new ArrayBuffer(SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1));

    const mounts = await loadInstalledModuleMounts();
    try {
      expect(mounts).toHaveLength(2);
      const opens = workers.map(
        (worker) => worker.postMessage.mock.calls[0]?.[0] as OpenWorkerRequest,
      );
      expect(opens[0]?.poolName).not.toBe(opens[1]?.poolName);
      expect(opens[0]?.databaseName).not.toBe(opens[1]?.databaseName);
    } finally {
      await Promise.all(mounts.map((mount) => mount.store.close()));
    }
  });

  it('validates oversized modules without changing the small in-memory path', async () => {
    installObjectUrlDouble();
    const workers = installWorkerDouble();
    const validator = new BrowserModuleValidator();
    const largeResult = await validator.validate(
      moduleEntry('minimed.esklp.ru'),
      new Uint8Array(new ArrayBuffer(SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1)),
    );

    expect(largeResult).toMatchObject({
      valid: true,
      schemaCompatible: true,
      sqliteIntegrity: 'ok',
    });
    expect(workers).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:module-1');

    const smallStore = {
      initialize: vi.fn(async () => ({
        ...HEALTH,
        persistent: false,
        installation: 'memory' as const,
      })),
      inspectIntegrity: vi.fn(async () => INTEGRITY),
      close: vi.fn(async () => undefined),
    } as unknown as SqliteMedicalStore;
    const createFromBytes = vi
      .spyOn(SqliteMedicalStore, 'createFromBytes')
      .mockResolvedValue(smallStore);
    const smallBytes = new Uint8Array([1, 2, 3]);
    const smallResult = await validator.validate(moduleEntry('minimed.small'), smallBytes);

    expect(smallResult.valid).toBe(true);
    expect(createFromBytes).toHaveBeenCalledWith(smallBytes);
    expect(workers).toHaveLength(1);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });
});
