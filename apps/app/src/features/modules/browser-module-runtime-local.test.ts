import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  type ContentModuleCatalog,
  type ContentModuleCatalogEntry,
  ContentModuleCatalogSchema,
} from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserContentModuleRuntime,
  BrowserModuleBackend,
  BrowserModuleValidator,
} from '@/features/modules/browser-module-runtime';
import {
  LOCAL_MODULE_STORE,
  loadLocalModuleEntries,
  resetLocalModuleEntriesForTests,
} from '@/features/modules/local-module-entries';
import { ModuleFileImportError, openModuleBundle } from '@/features/modules/module-file-import';
import {
  type IndexedDbStoreDouble,
  installMultiStoreIndexedDbDouble,
} from '@/features/network/indexeddb-test-double';

const FIXTURE = fileURLToPath(
  new URL('./test-fixtures/fixture-local.minimed-module.zip', import.meta.url),
);
const MODULE_ID = 'minimed.reference.fixture-local';

function fixtureBlob(): Blob {
  return new Blob([new Uint8Array(readFileSync(FIXTURE))]);
}

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

function publicCatalog(extra: readonly ContentModuleCatalogEntry[] = []): ContentModuleCatalog {
  const core: ContentModuleCatalogEntry = {
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
    publishedAt: '2026-10-12T00:00:00Z',
    categories: [],
    modules: [core, ...extra],
  });
}

describe('installing a module from a file in the browser runtime', () => {
  let stores: Map<string, IndexedDbStoreDouble>;
  let runtime: BrowserContentModuleRuntime | undefined;

  beforeEach(() => {
    resetLocalModuleEntriesForTests();
    stores = new Map([
      ['versions', { keyPath: 'key', records: new Map() }],
      ['active', { keyPath: 'moduleId', records: new Map() }],
      [LOCAL_MODULE_STORE, { keyPath: 'key', records: new Map() }],
    ]);
    installMultiStoreIndexedDbDouble(stores);
    vi.stubGlobal('window', {
      localStorage: memoryStorage(),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The test double has no key cursor; the stored rows are dropped directly.
    vi.spyOn(BrowserModuleBackend.prototype, 'remove').mockImplementation(async (moduleId) => {
      stores.get('active')?.records.delete(moduleId);
      for (const key of [...(stores.get('versions')?.records.keys() ?? [])]) {
        if (key.startsWith(`${moduleId}@`)) stores.get('versions')?.records.delete(key);
      }
    });
    vi.spyOn(BrowserModuleValidator.prototype, 'validate').mockResolvedValue({
      checkedAt: '2026-10-12T00:00:00Z',
      valid: true,
      checksumValid: true,
      schemaCompatible: true,
      sqliteIntegrity: 'ok',
      message: 'ok',
    });
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('installs, lists the module in the catalog, keeps it across a restart and forgets it on removal', async () => {
    runtime = new BrowserContentModuleRuntime(publicCatalog());
    const changes = vi.fn();
    runtime.subscribeCatalog(changes);
    const bundle = await openModuleBundle(fixtureBlob(), 'fixture.minimed-module.zip');
    expect(runtime.getCatalog().modules.map((module) => module.id)).not.toContain(MODULE_ID);

    const task = runtime.installFromBundle(bundle);
    // The descriptor is in the catalog while the install runs, so the queue can name it.
    expect(runtime.getCatalog().modules.map((module) => module.id)).toContain(MODULE_ID);
    const finished = await runtime.wait(task.id);

    expect(finished.state).toBe('completed');
    expect(runtime.listInstalled().map((module) => module.moduleId)).toEqual([MODULE_ID]);
    expect(stores.get(LOCAL_MODULE_STORE)?.records.has(`${MODULE_ID}@2026.10.12`)).toBe(true);
    expect(runtime.getCatalog().modules.map((module) => module.id)).toContain(MODULE_ID);
    expect(changes).toHaveBeenCalled();

    // A restart with a catalog that no remote refresh knows the module in.
    runtime.dispose();
    resetLocalModuleEntriesForTests();
    runtime = new BrowserContentModuleRuntime(publicCatalog());
    await loadLocalModuleEntries();
    expect(runtime.getCatalog().modules.map((module) => module.id)).toContain(MODULE_ID);
    // A catalog refresh replaces the public part and leaves the module from the file in place.
    runtime.updateCatalog(publicCatalog());
    expect(runtime.getCatalog().modules.map((module) => module.id)).toContain(MODULE_ID);
    expect(runtime.listInstalled().map((module) => module.moduleId)).toEqual([MODULE_ID]);

    await runtime.remove(MODULE_ID);
    expect(runtime.listInstalled()).toHaveLength(0);
    expect(runtime.getCatalog().modules.map((module) => module.id)).not.toContain(MODULE_ID);
    expect(stores.get(LOCAL_MODULE_STORE)?.records.size).toBe(0);
  });

  it('refuses a module whose id belongs to a public module', async () => {
    const bundle = await openModuleBundle(fixtureBlob());
    const publicTwin: ContentModuleCatalogEntry = {
      ...bundle.entry,
      releaseState: 'published',
      artifacts: bundle.entry.artifacts.map((artifact) => ({
        ...artifact,
        url: 'https://example.invalid/fixture.db.gz',
      })),
    };
    runtime = new BrowserContentModuleRuntime(publicCatalog([publicTwin]));

    expect(() => runtime?.installFromBundle(bundle)).toThrow(ModuleFileImportError);
    expect(() => runtime?.installFromBundle(bundle)).toThrow('Такой модуль уже есть в каталоге');
    expect(runtime.listInstalled()).toHaveLength(0);
  });

  it('refuses a build that is already installed and leaves no half-installed entry on failure', async () => {
    runtime = new BrowserContentModuleRuntime(publicCatalog());
    const bundle = await openModuleBundle(fixtureBlob());
    await runtime.wait(runtime.installFromBundle(bundle).id);
    expect(() => runtime?.installFromBundle(bundle)).toThrow('Этот модуль уже установлен.');

    await runtime.remove(MODULE_ID);
    const damaged = await openModuleBundle(fixtureBlob());
    vi.spyOn(damaged, 'readArtifact').mockImplementation(async (artifact) => {
      const bytes = new Uint8Array(await bundle.readArtifact(artifact));
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      return bytes;
    });
    const failed = await runtime.wait(runtime.installFromBundle(damaged).id);

    expect(failed.state).toBe('failed');
    expect(failed.errorMessage).toContain('checksum mismatch');
    expect(runtime.listInstalled()).toHaveLength(0);
    expect(runtime.getCatalog().modules.map((module) => module.id)).not.toContain(MODULE_ID);
    expect(() => runtime?.retry(failed.id)).toThrow('Выберите файл модуля ещё раз.');
  });
});
