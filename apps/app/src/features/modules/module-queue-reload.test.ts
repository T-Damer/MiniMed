import { createHash } from 'node:crypto';

import {
  type ContentModuleCatalog,
  type ContentModuleCatalogEntry,
  ContentModuleCatalogSchema,
} from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type IndexedDbStoreDouble,
  installMultiStoreIndexedDbDouble,
} from '@/features/network/indexeddb-test-double';

/**
 * DL3: «pause → reload → resume» of a big multi-module queue ends with every module installed and
 * not one failed. The real module runtime, download queue, resumable transport, pending-install
 * journal and installer run against an in-memory server; only the SQLite validation is stubbed.
 * A reload is a fresh module graph over the same localStorage and IndexedDB.
 */
const MODULE_COUNT = 18;
const CHUNK = 4 * 1024;
const MODULE_BYTES = 40 * 1024;
/** Modules whose stream stalls after three chunks until released: they are in flight at the pause. */
const STALLED = new Set([6, 7, 8]);
/** Modules whose validation never ends in the first page: they are «Проверяем» when it is closed. */
const VALIDATING = new Set([3, 4]);

const CHECKSUM = `sha256:${'a'.repeat(64)}`;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function moduleBytes(index: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(MODULE_BYTES);
  for (let position = 0; position < bytes.length; position += 1) {
    bytes[position] = (position * 31 + index * 17 + (position >> 8)) & 0xff;
  }
  return bytes;
}

const BYTES = Array.from({ length: MODULE_COUNT }, (_, index) => moduleBytes(index));

function entry(index: number): ContentModuleCatalogEntry {
  const bytes = BYTES[index] as Uint8Array<ArrayBuffer>;
  return {
    id: `minimed.test.queue-${index}`,
    version: '1.0.0',
    kind: 'tool',
    collection: 'test',
    title: `Набор ${index}`,
    description: 'Тестовый набор.',
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
      downloadBytes: bytes.byteLength,
      installedBytes: bytes.byteLength,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
    },
    capabilities: {
      search: false,
      fullText: false,
      structuredTables: false,
      images: false,
      originalPdf: false,
      structuredKnowledge: false,
      calculations: true,
    },
    artifacts: [
      {
        id: `index-${index}`,
        kind: 'index',
        required: true,
        url: `https://modules.example.test/queue/m${index}.db`,
        sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        sizeBytes: bytes.byteLength,
        compression: 'none',
        sourceSetDigest: CHECKSUM,
      },
    ],
    documents: [],
    previewDocumentCount: 0,
  } as unknown as ContentModuleCatalogEntry;
}

function catalog(): ContentModuleCatalog {
  const core = {
    id: 'minimed.core.ru',
    version: '1.0.0',
    kind: 'core',
    collection: 'core',
    title: 'Ядро',
    description: 'Ядро.',
    required: true,
    releaseState: 'bundled',
    specialties: [],
    populations: [],
    tags: [],
    compatibility: {
      minAppVersion: '0.3.1',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: null,
    dependencies: [],
    sizes: {
      downloadBytes: 0,
      installedBytes: 1,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
    },
    capabilities: {
      search: true,
      fullText: false,
      structuredTables: false,
      images: false,
      originalPdf: false,
      structuredKnowledge: true,
      calculations: false,
    },
    artifacts: [],
    documents: [],
    previewDocumentCount: 0,
  };
  return ContentModuleCatalogSchema.parse({
    catalogVersion: 'test',
    channel: 'preview',
    publishedAt: '2026-10-15T00:00:00Z',
    categories: [],
    modules: [core, ...Array.from({ length: MODULE_COUNT }, (_, index) => entry(index))],
  });
}

interface ServerLog {
  readonly index: number;
  readonly rangeStart: number;
}

describe('pause → reload → resume of a multi-module download queue', () => {
  let stores: Map<string, IndexedDbStoreDouble>;
  let storage: Storage;
  const requests: ServerLog[] = [];
  let stallActive = true;
  let releaseStall: () => void = () => undefined;
  let stalled: Promise<void>;
  let generation = 0;
  let validationStall = false;
  /** Modules whose first transfer dies with the browser's «file could not be read» after two chunks. */
  const unreadableOnce = new Set<number>();

  function server(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    const index = Number(/\/m(\d+)\.db$/u.exec(url)?.[1]);
    const data = BYTES[index];
    if (!data) return Promise.resolve(new Response(null, { status: 404 }));
    const range = /^bytes=(\d+)-$/u.exec(
      new Headers(init?.headers as Record<string, string> | undefined).get('range') ?? '',
    );
    const start = range ? Number(range[1]) : 0;
    requests.push({ index, rangeStart: start });
    const signal = init?.signal ?? undefined;
    const born = generation;
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const body = data.slice(start);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // A page that went away answers nothing any more.
        if (born !== generation) return new Promise<void>(() => undefined);
        if (signal?.aborted) {
          controller.error(new DOMException('Aborted', 'AbortError'));
          return;
        }
        if (stallActive && STALLED.has(index) && start === 0 && sent >= 3 * CHUNK) {
          await Promise.race([
            stalled,
            new Promise<void>((resolve) =>
              signal?.addEventListener('abort', () => resolve(), { once: true }),
            ),
          ]);
          if (signal?.aborted) {
            controller.error(new DOMException('Aborted', 'AbortError'));
            return;
          }
        }
        if (unreadableOnce.has(index) && sent >= 2 * CHUNK) {
          unreadableOnce.delete(index);
          controller.error(
            new DOMException('The requested file could not be read.', 'NotReadableError'),
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (sent >= body.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(body.slice(sent, sent + CHUNK));
        sent += CHUNK;
      },
    });
    return Promise.resolve(
      new Response(stream, {
        status: start > 0 ? 206 : 200,
        headers: {
          'content-length': String(body.byteLength),
          ...(start > 0
            ? { 'content-range': `bytes ${start}-${data.byteLength - 1}/${data.byteLength}` }
            : {}),
        },
      }),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    requests.length = 0;
    stallActive = true;
    stalled = new Promise<void>((resolve) => {
      releaseStall = resolve;
    });
    generation = 0;
    validationStall = false;
    unreadableOnce.clear();
    storage = memoryStorage();
    stores = new Map([
      ['versions', { keyPath: 'key', records: new Map() }],
      ['active', { keyPath: 'moduleId', records: new Map() }],
      ['partials', { keyPath: 'key', records: new Map() }],
    ]);
    installMultiStoreIndexedDbDouble(stores);
    vi.stubGlobal('window', {
      localStorage: storage,
      location: { href: 'http://localhost/', origin: 'http://localhost' },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('fetch', server);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function boot() {
    const runtimeModule = await import('@/features/modules/browser-module-runtime');
    const serviceModule = await import('@/features/downloads/download-service');
    const validator = runtimeModule.BrowserModuleValidator.prototype;
    const born = generation;
    vi.spyOn(validator, 'validate').mockImplementation(
      async (module: ContentModuleCatalogEntry) => {
        const index = Number(/queue-(\d+)$/u.exec(module.id)?.[1]);
        // A page that is closed while a module is being checked never hears the answer.
        if (validationStall && VALIDATING.has(index) && born === generation) {
          await new Promise<void>(() => undefined);
        }
        return {
          checkedAt: '2026-10-15T00:00:00Z',
          valid: true,
          checksumValid: true,
          schemaCompatible: true,
          sqliteIntegrity: 'ok' as const,
          message: 'ok',
        };
      },
    );
    const operations = await import('@/features/modules/recommendation-category-operations');
    const runtime = new runtimeModule.BrowserContentModuleRuntime(catalog());
    return { runtime, queue: serviceModule.getDownloadQueue(), operations };
  }

  const modules = (): ContentModuleCatalogEntry[] =>
    catalog().modules.filter((module) => module.kind === 'tool');

  it('installs every module with no failure after a pause, a reload and a resume', async () => {
    const first = await boot();
    // «Скачать всё»: every module is queued, three at a time are moving.
    void first.operations.installPublishedCategoryModules(first.runtime, modules(), new Set());
    // Modules 0-5 finish; 6, 7 and 8 stall mid-stream with three chunks received.
    await vi.waitFor(
      () => {
        expect(first.runtime.listInstalled().length).toBe(6);
        expect(requests.filter((request) => STALLED.has(request.index))).toHaveLength(3);
      },
      { timeout: 15_000 },
    );
    await vi.waitFor(() => expect(first.queue.activeTransfers).toBe(3), { timeout: 5_000 });

    // Pause: the three moving transfers stop, nothing else is admitted, partial bytes are kept.
    first.queue.setPaused(true);
    await vi.waitFor(() => expect(first.queue.activeTransfers).toBe(0), { timeout: 5_000 });
    const moved = requests.length;
    const partial = stores.get('partials');
    expect([...(partial?.records.keys() ?? [])].length).toBe(3);
    expect(first.queue.list().filter((task) => task.state === 'failed')).toHaveLength(0);

    // Reload: the old page is gone; a new module graph reads the same storage.
    // (The old graph is simply abandoned, as a closed tab is: disposing it would cancel its tasks.)
    generation += 1;
    stallActive = false;
    releaseStall();
    vi.resetModules();
    const second = await boot();

    expect(second.queue.isPaused()).toBe(true);
    expect(second.runtime.listInstalled().length).toBe(6);
    // Held after the reload: no module bytes are requested while paused.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests.length).toBe(moved);
    expect(second.queue.list().filter((task) => task.state === 'failed')).toHaveLength(0);

    // Resume: every unfinished module completes; the cut ones continue from their partial bytes.
    second.queue.setPaused(false);
    await vi.waitFor(() => expect(second.runtime.listInstalled().length).toBe(MODULE_COUNT), {
      timeout: 30_000,
    });
    expect(second.queue.list().filter((task) => task.state === 'failed')).toHaveLength(0);
    expect(second.runtime.listTasks().filter((task) => task.state === 'failed')).toHaveLength(0);
    const resumed = requests.slice(moved).filter((request) => STALLED.has(request.index));
    expect(resumed).toHaveLength(3);
    for (const request of resumed) expect(request.rangeStart).toBeGreaterThanOrEqual(2 * CHUNK);
    expect(second.queue.isPaused()).toBe(false);
    second.runtime.dispose();
  });
  it('installs every module after a reload that cuts modules in the middle of their validation', async () => {
    stallActive = false;
    validationStall = true;
    const first = await boot();
    void first.operations.installPublishedCategoryModules(first.runtime, modules(), new Set());
    // Modules 3 and 4 are downloaded and «Проверяем»; the rest of the queue moves around them.
    await vi.waitFor(
      () => {
        const verifying = first.queue.list().filter((task) => task.state === 'verifying');
        expect(verifying).toHaveLength(2);
        expect(first.runtime.listInstalled().length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 15_000 },
    );
    first.queue.setPaused(true);
    await vi.waitFor(() => expect(first.queue.activeTransfers).toBe(0), { timeout: 5_000 });

    generation += 1;
    validationStall = false;
    vi.resetModules();
    const second = await boot();
    expect(second.queue.isPaused()).toBe(true);
    second.queue.setPaused(false);
    await vi.waitFor(() => expect(second.runtime.listInstalled().length).toBe(MODULE_COUNT), {
      timeout: 30_000,
    });
    expect(second.queue.list().filter((task) => task.state === 'failed')).toHaveLength(0);
    expect(second.runtime.listTasks().filter((task) => task.state === 'failed')).toHaveLength(0);
  });
  it('restarts a module whose transfer dies with «file could not be read» instead of failing it', async () => {
    stallActive = false;
    unreadableOnce.add(10);
    const first = await boot();
    await first.operations.installPublishedCategoryModules(first.runtime, modules(), new Set());
    await vi.waitFor(() => expect(first.runtime.listInstalled().length).toBe(MODULE_COUNT), {
      timeout: 30_000,
    });
    expect(first.runtime.listTasks().filter((task) => task.state === 'failed')).toHaveLength(0);
    // Two transfers of that module: the cut one and the clean restart from the first byte.
    const mine = requests.filter((request) => request.index === 10);
    expect(mine).toHaveLength(2);
    expect(mine[1]?.rangeStart).toBe(0);
    first.runtime.dispose();
  });
});
