import type { ContentModuleCatalog } from '@localmed/contracts';
import {
  type ContentModuleCatalogCacheRecord,
  type ContentModuleCatalogResponse,
  loadContentModuleCatalog,
} from '@localmed/core';
import { describe, expect, it, vi } from 'vitest';

function catalog(version: string): ContentModuleCatalog {
  return {
    catalogVersion: version,
    channel: 'preview',
    publishedAt: '2026-07-21T00:00:00Z',
    modules: [
      {
        id: 'minimed.core.ru',
        version: '1.0.0',
        kind: 'core',
        collection: 'core',
        title: 'Ядро',
        description: 'Минимальный каталог.',
        required: true,
        releaseState: 'bundled',
        specialties: [],
        populations: ['all'],
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
      },
    ],
  };
}

function response(options: {
  readonly status: number;
  readonly body?: unknown;
  readonly etag?: string;
}): ContentModuleCatalogResponse {
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'etag' ? (options.etag ?? null) : null;
      },
    },
    async json(): Promise<unknown> {
      return options.body;
    },
  };
}

function cache(initial: ContentModuleCatalogCacheRecord | null = null) {
  let record: ContentModuleCatalogCacheRecord | null = initial;
  return {
    async read(): Promise<unknown | null> {
      return record;
    },
    async write(value: ContentModuleCatalogCacheRecord): Promise<void> {
      record = value;
    },
    current(): ContentModuleCatalogCacheRecord | null {
      return record;
    },
  };
}

const now = () => '2026-07-21T12:00:00Z';

describe('loadContentModuleCatalog', () => {
  it('uses and caches a valid remote catalog', async () => {
    const storage = cache();
    const fetcher = vi.fn(async () =>
      response({ status: 200, body: catalog('remote'), etag: 'v1' }),
    );

    const result = await loadContentModuleCatalog({
      bundledCatalog: catalog('bundled'),
      remoteUrl: 'https://example.test/catalog.json',
      cache: storage,
      fetcher,
      now,
    });

    expect(result.source).toBe('remote');
    expect(result.catalog.catalogVersion).toBe('remote');
    expect(storage.current()?.etag).toBe('v1');
  });

  it('sends validators and uses cache on 304', async () => {
    const storage = cache({
      catalog: catalog('cached'),
      etag: 'etag-1',
      lastModified: 'Mon, 21 Jul 2026 10:00:00 GMT',
      fetchedAt: '2026-07-21T10:00:00Z',
    });
    const fetcher = vi.fn(
      async (_url: string, init: { headers: Readonly<Record<string, string>> }) => {
        expect(init.headers['If-None-Match']).toBe('etag-1');
        expect(init.headers['If-Modified-Since']).toContain('21 Jul 2026');
        return response({ status: 304 });
      },
    );

    const result = await loadContentModuleCatalog({
      bundledCatalog: catalog('bundled'),
      remoteUrl: 'https://example.test/catalog.json',
      cache: storage,
      fetcher,
      now,
    });

    expect(result.source).toBe('cache');
    expect(result.catalog.catalogVersion).toBe('cached');
    expect(result.warning).toBeNull();
  });

  it('keeps valid cache when remote JSON is invalid', async () => {
    const storage = cache({
      catalog: catalog('cached'),
      etag: null,
      lastModified: null,
      fetchedAt: '2026-07-21T10:00:00Z',
    });

    const result = await loadContentModuleCatalog({
      bundledCatalog: catalog('bundled'),
      remoteUrl: 'https://example.test/catalog.json',
      cache: storage,
      fetcher: async () => response({ status: 200, body: { broken: true } }),
      now,
    });

    expect(result.source).toBe('cache');
    expect(result.catalog.catalogVersion).toBe('cached');
    expect(result.warning).toBeTruthy();
  });

  it('uses bundled catalog when network and cache are unavailable', async () => {
    const result = await loadContentModuleCatalog({
      bundledCatalog: catalog('bundled'),
      remoteUrl: 'https://example.test/catalog.json',
      cache: cache(),
      fetcher: async () => {
        throw new Error('offline');
      },
      now,
    });

    expect(result.source).toBe('bundled');
    expect(result.catalog.catalogVersion).toBe('bundled');
    expect(result.warning).toBe('offline');
  });

  it('ignores malformed cache records', async () => {
    const malformedCache = {
      async read(): Promise<unknown> {
        return { catalog: { invalid: true } };
      },
      async write(): Promise<void> {},
    };

    const result = await loadContentModuleCatalog({
      bundledCatalog: catalog('bundled'),
      remoteUrl: 'https://example.test/catalog.json',
      cache: malformedCache,
      fetcher: async () => {
        throw new Error('offline');
      },
      now,
    });

    expect(result.source).toBe('bundled');
  });
});
