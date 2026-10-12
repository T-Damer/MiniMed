import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type IndexedDbStoreDouble,
  installMultiStoreIndexedDbDouble,
} from '@/features/network/indexeddb-test-double';

import {
  LOCAL_MODULE_STORE,
  loadLocalModuleEntries,
  localModuleEntries,
  mergeLocalModuleEntries,
  removeLocalModuleEntries,
  resetLocalModuleEntriesForTests,
  saveLocalModuleEntry,
  subscribeLocalModuleEntries,
} from './local-module-entries';

const DIGEST = `sha256:${'c'.repeat(64)}`;

function entry(id: string, version: string): ContentModuleCatalogEntry {
  return {
    id,
    version,
    kind: 'reference',
    collection: 'reference',
    title: `Модуль ${id}`,
    description: 'Из файла.',
    required: false,
    releaseState: 'preview',
    specialties: [],
    populations: [],
    tags: [],
    compatibility: {
      minAppVersion: '0.6.0',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: DIGEST,
    dependencies: [],
    sizes: {
      downloadBytes: 10,
      installedBytes: 20,
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
        id: `${id}-index`,
        kind: 'index',
        required: true,
        url: 'minimed-local:artifacts/index.db.gz',
        sha256: DIGEST,
        sizeBytes: 10,
        compression: 'gzip',
        decodedSha256: DIGEST,
        decodedSizeBytes: 20,
        sourceSetDigest: DIGEST,
      },
    ],
    documents: [],
    previewDocumentCount: 0,
  };
}

function catalogOf(...ids: string[]): ContentModuleCatalog {
  return {
    catalogVersion: 'test',
    channel: 'preview',
    publishedAt: '2026-10-12T00:00:00Z',
    categories: [],
    modules: ids.map((id) => ({ ...entry(id, '1.0.0'), releaseState: 'published' as const })),
  };
}

describe('local module entries', () => {
  let stores: Map<string, IndexedDbStoreDouble>;

  beforeEach(() => {
    resetLocalModuleEntriesForTests();
    stores = new Map();
    installMultiStoreIndexedDbDouble(stores);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('survives a restart: a saved descriptor is read back from storage', async () => {
    await saveLocalModuleEntry(entry('minimed.reference.vidal', '2026.10.1'));
    expect(stores.get(LOCAL_MODULE_STORE)?.records.size).toBe(1);

    resetLocalModuleEntriesForTests();
    expect(localModuleEntries()).toHaveLength(0);
    await loadLocalModuleEntries();

    expect(localModuleEntries().map((item) => `${item.id}@${item.version}`)).toEqual([
      'minimed.reference.vidal@2026.10.1',
    ]);
  });

  it('keeps one row per version and notifies listeners of changes', async () => {
    const listener = vi.fn();
    subscribeLocalModuleEntries(listener);
    await saveLocalModuleEntry(entry('a', '1'));
    await saveLocalModuleEntry(entry('a', '2'));

    expect(stores.get(LOCAL_MODULE_STORE)?.records.size).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('removes other versions of a module and all of them when nothing is kept', async () => {
    await saveLocalModuleEntry(entry('a', '1'));
    await saveLocalModuleEntry(entry('a', '2'));
    await saveLocalModuleEntry(entry('b', '1'));

    await removeLocalModuleEntries('a', new Set(['2']));
    expect([...(stores.get(LOCAL_MODULE_STORE)?.records.keys() ?? [])].sort()).toEqual([
      'a@2',
      'b@1',
    ]);

    await removeLocalModuleEntries('a', new Set());
    expect([...(stores.get(LOCAL_MODULE_STORE)?.records.keys() ?? [])]).toEqual(['b@1']);
    expect(localModuleEntries().map((item) => item.id)).toEqual(['b']);
  });

  it('ignores a stored row that no longer passes the entry schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await saveLocalModuleEntry(entry('good', '1'));
    stores.get(LOCAL_MODULE_STORE)?.records.set('bad@1', {
      key: 'bad@1',
      moduleId: 'bad',
      version: '1',
      importedAt: '2026-10-12T00:00:00Z',
      entry: { id: 'bad' },
    });

    resetLocalModuleEntriesForTests();
    await loadLocalModuleEntries();

    expect(localModuleEntries().map((item) => item.id)).toEqual(['good']);
    expect(warn).toHaveBeenCalled();
  });
});

describe('mergeLocalModuleEntries', () => {
  it('appends modules the catalog does not know and lets a public module win', () => {
    const catalog = catalogOf('public.one');
    const merged = mergeLocalModuleEntries(catalog, [
      entry('local.one', '1'),
      entry('public.one', '9'),
    ]);

    expect(merged.modules.map((module) => module.id)).toEqual(['public.one', 'local.one']);
    expect(merged.modules[0]?.version).toBe('1.0.0');
  });

  it('returns the same catalog when there is nothing to add', () => {
    const catalog = catalogOf('public.one');
    expect(mergeLocalModuleEntries(catalog, [])).toBe(catalog);
    expect(mergeLocalModuleEntries(catalog, [entry('public.one', '2')])).toBe(catalog);
  });
});
