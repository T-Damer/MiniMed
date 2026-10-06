import { CONTENT_MODULE_CATALOG_CACHE_FORMAT, loadContentModuleCatalog } from '@localmed/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type IndexedDbStoreDouble,
  installMultiStoreIndexedDbDouble,
} from '@/features/network/indexeddb-test-double';

import {
  CATALOG_CACHE_RECORD_KEY,
  CATALOG_CACHE_STORE,
  IndexedDbContentModuleCatalogCache,
  LEGACY_CATALOG_CACHE_KEY,
  removeLegacyCatalogRecord,
} from './catalog-cache';
import { BASE_MODULE_CATALOG } from './module-catalog';

function installStores(): Map<string, IndexedDbStoreDouble> {
  const stores = new Map<string, IndexedDbStoreDouble>();
  installMultiStoreIndexedDbDouble(stores);
  return stores;
}

function recordOf(stores: Map<string, IndexedDbStoreDouble>): Record<string, unknown> | undefined {
  return stores.get(CATALOG_CACHE_STORE)?.records.get(CATALOG_CACHE_RECORD_KEY);
}

const NEWER_CATALOG = { ...BASE_MODULE_CATALOG, publishedAt: '2100-01-01T00:00:00Z' };

describe('IndexedDbContentModuleCatalogCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads nothing from an empty store', async () => {
    installStores();
    expect(await new IndexedDbContentModuleCatalogCache().read()).toBeNull();
  });

  it('round-trips a record, keeping the catalog as JSON text', async () => {
    const stores = installStores();
    const cache = new IndexedDbContentModuleCatalogCache();
    const record = {
      format: CONTENT_MODULE_CATALOG_CACHE_FORMAT,
      appVersion: '0.6.52',
      catalog: NEWER_CATALOG,
      publishedAt: NEWER_CATALOG.publishedAt,
      etag: 'W/"abc"',
      lastModified: null,
      fetchedAt: '2026-10-06T12:00:00Z',
    };

    await cache.write(record);

    expect(typeof recordOf(stores)?.['catalogJson']).toBe('string');
    expect(await cache.read()).toEqual(record);
  });

  it('stores a validators-only record without a catalog body', async () => {
    const stores = installStores();
    const cache = new IndexedDbContentModuleCatalogCache();

    await cache.write({
      format: CONTENT_MODULE_CATALOG_CACHE_FORMAT,
      appVersion: '0.6.52',
      catalog: null,
      publishedAt: '2026-10-06T00:00:00Z',
      etag: 'W/"abc"',
      lastModified: null,
      fetchedAt: '2026-10-06T12:00:00Z',
    });

    expect(recordOf(stores)?.['catalogJson']).toBeNull();
    expect(await cache.read()).toMatchObject({ catalog: null, etag: 'W/"abc"' });
  });

  it('removes and reports a record that is not the stored shape', async () => {
    const stores = installStores();
    stores.set(CATALOG_CACHE_STORE, {
      keyPath: 'key',
      records: new Map([[CATALOG_CACHE_RECORD_KEY, { key: CATALOG_CACHE_RECORD_KEY, junk: 1 }]]),
    });
    const cache = new IndexedDbContentModuleCatalogCache();

    await expect(cache.read()).rejects.toThrow('повреждён');
    expect(recordOf(stores)).toBeUndefined();
    expect(await cache.read()).toBeNull();
  });

  it('removes and reports a record whose JSON text is damaged', async () => {
    const stores = installStores();
    stores.set(CATALOG_CACHE_STORE, {
      keyPath: 'key',
      records: new Map([
        [
          CATALOG_CACHE_RECORD_KEY,
          {
            key: CATALOG_CACHE_RECORD_KEY,
            format: CONTENT_MODULE_CATALOG_CACHE_FORMAT,
            appVersion: '0.6.52',
            publishedAt: '2026-10-06T00:00:00Z',
            etag: null,
            lastModified: null,
            fetchedAt: '2026-10-06T12:00:00Z',
            catalogJson: '{"modules": [',
          },
        ],
      ]),
    });
    const cache = new IndexedDbContentModuleCatalogCache();

    await expect(cache.read()).rejects.toThrow('повреждён');
    expect(recordOf(stores)).toBeUndefined();
  });

  it('feeds the core loader: a second load sends the stored validator and gets a 304', async () => {
    installStores();
    const cache = new IndexedDbContentModuleCatalogCache();
    const bodies: string[] = [];
    const fetcher = vi.fn(
      async (_url: string, init: { readonly headers: Readonly<Record<string, string>> }) => {
        const validator = init.headers['If-None-Match'];
        bodies.push(validator ?? 'none');
        if (validator === 'v1') {
          return { ok: false, status: 304, headers: { get: () => null }, json: async () => null };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: (name: string) => (name === 'etag' ? 'v1' : null) },
          json: async () => NEWER_CATALOG,
        };
      },
    );
    const base = {
      bundledCatalog: BASE_MODULE_CATALOG,
      remoteUrl: 'https://example.test/catalog.json',
      cache,
      appVersion: '0.6.52',
      fetcher,
    };

    const first = await loadContentModuleCatalog(base);
    const second = await loadContentModuleCatalog(base);

    expect(bodies).toEqual(['none', 'v1']);
    expect(first.source).toBe('remote');
    expect(first.network).toBe('downloaded');
    expect(second.source).toBe('cache');
    expect(second.network).toBe('not-modified');
    expect(second.catalog.publishedAt).toBe(NEWER_CATALOG.publishedAt);
  });

  it('reports a failed write to the loader callback and still resolves the remote', async () => {
    const stores = installStores();
    stores.set(CATALOG_CACHE_STORE, { keyPath: 'key', records: new Map() });
    installMultiStoreIndexedDbDouble(stores, { failWritesToStoreOnce: CATALOG_CACHE_STORE });
    const failures: string[] = [];

    const result = await loadContentModuleCatalog({
      bundledCatalog: BASE_MODULE_CATALOG,
      remoteUrl: 'https://example.test/catalog.json',
      cache: new IndexedDbContentModuleCatalogCache(),
      appVersion: '0.6.52',
      fetcher: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => NEWER_CATALOG,
      }),
      onCacheFailure: (stage) => failures.push(stage),
    });

    expect(result.source).toBe('remote');
    expect(failures).toEqual(['write']);
  });
});

describe('removeLegacyCatalogRecord', () => {
  it('removes the retired localStorage key', () => {
    const removed: string[] = [];
    removeLegacyCatalogRecord({ removeItem: (key) => removed.push(key) });
    expect(removed).toEqual([LEGACY_CATALOG_CACHE_KEY]);
  });
});
