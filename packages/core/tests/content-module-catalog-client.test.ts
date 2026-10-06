import type { ContentModuleCatalog } from '@localmed/contracts';
import {
  CONTENT_MODULE_CATALOG_CACHE_FORMAT,
  type ContentModuleCatalogCacheRecord,
  type ContentModuleCatalogResponse,
  catalogLoadWarningFromCause,
  loadContentModuleCatalog,
} from '@localmed/core';
import { describe, expect, it, vi } from 'vitest';

function catalog(version: string, publishedAt = '2026-07-21T00:00:00Z'): ContentModuleCatalog {
  return {
    catalogVersion: version,
    channel: 'preview',
    publishedAt,
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

const APP_VERSION = '0.6.52';

function record(
  overrides: Partial<ContentModuleCatalogCacheRecord> & {
    readonly catalog: ContentModuleCatalog | null;
  },
): ContentModuleCatalogCacheRecord {
  return {
    format: CONTENT_MODULE_CATALOG_CACHE_FORMAT,
    appVersion: APP_VERSION,
    publishedAt: overrides.catalog?.publishedAt ?? '2026-07-21T00:00:00Z',
    etag: null,
    lastModified: null,
    fetchedAt: '2026-07-21T10:00:00Z',
    ...overrides,
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

describe('catalogLoadWarningFromCause', () => {
  it('hides Zod validation details behind a short Russian warning', () => {
    expect(
      catalogLoadWarningFromCause({
        name: 'ZodError',
        issues: [{ code: 'invalid_enum_value', path: ['modules', 0, 'kind'], message: 'Invalid' }],
      }),
    ).toBe('Удалённый каталог не прошёл проверку; используется встроенный.');

    expect(
      catalogLoadWarningFromCause(
        new Error(
          '[{"code":"invalid_enum_value","path":["modules",0,"kind"],"message":"Invalid enum value"}]',
        ),
      ),
    ).toBe('Удалённый каталог не прошёл проверку; используется встроенный.');
  });
});

const NEWER = '2026-07-22T00:00:00Z';
const BUNDLED_DATE = '2026-07-21T00:00:00Z';
const OLDER = '2026-07-20T00:00:00Z';

function options(overrides: Partial<Parameters<typeof loadContentModuleCatalog>[0]> = {}) {
  return {
    bundledCatalog: catalog('bundled', BUNDLED_DATE),
    remoteUrl: 'https://example.test/catalog.json',
    cache: cache(),
    appVersion: APP_VERSION,
    now,
    ...overrides,
  };
}

describe('loadContentModuleCatalog', () => {
  it('keeps bundled catalog without warning when remote metadata matches bundled', async () => {
    const storage = cache();
    const result = await loadContentModuleCatalog(
      options({
        cache: storage,
        fetcher: async () =>
          response({ status: 200, body: catalog('remote', BUNDLED_DATE), etag: 'v1' }),
      }),
    );

    expect(result.source).toBe('bundled');
    expect(result.catalog.catalogVersion).toBe('bundled');
    expect(result.warning).toBeNull();
    expect(result.network).toBe('downloaded');
  });

  it('keeps bundled catalog when remote metadata is older', async () => {
    const result = await loadContentModuleCatalog(
      options({
        fetcher: async () => response({ status: 200, body: catalog('remote', OLDER), etag: 'v1' }),
      }),
    );

    expect(result.source).toBe('bundled');
    expect(result.catalog.catalogVersion).toBe('bundled');
    expect(result.warning).toContain('устарел');
  });

  it('uses and caches a valid remote catalog newer than the bundled one', async () => {
    const storage = cache();
    const result = await loadContentModuleCatalog(
      options({
        cache: storage,
        fetcher: async () => response({ status: 200, body: catalog('remote', NEWER), etag: 'v1' }),
      }),
    );

    expect(result.source).toBe('remote');
    expect(result.catalog.catalogVersion).toBe('remote');
    const stored = storage.current();
    expect(stored?.etag).toBe('v1');
    expect(stored?.appVersion).toBe(APP_VERSION);
    expect(stored?.format).toBe(CONTENT_MODULE_CATALOG_CACHE_FORMAT);
    expect(stored?.catalog?.catalogVersion).toBe('remote');
  });

  it('stores only validators when the remote does not beat the bundled catalog', async () => {
    const storage = cache();
    await loadContentModuleCatalog(
      options({
        cache: storage,
        fetcher: async () =>
          response({ status: 200, body: catalog('remote', BUNDLED_DATE), etag: 'v1' }),
      }),
    );

    expect(storage.current()?.catalog).toBeNull();
    expect(storage.current()?.etag).toBe('v1');
    expect(storage.current()?.publishedAt).toBe(BUNDLED_DATE);
  });

  describe('with a cached catalog', () => {
    it('sends validators and returns the cached catalog on 304', async () => {
      const fetcher = vi.fn(
        async (_url: string, init: { headers: Readonly<Record<string, string>> }) => {
          expect(init.headers['If-None-Match']).toBe('etag-1');
          expect(init.headers['If-Modified-Since']).toContain('21 Jul 2026');
          return response({ status: 304 });
        },
      );

      const result = await loadContentModuleCatalog(
        options({
          cache: cache(
            record({
              catalog: catalog('cached', NEWER),
              etag: 'etag-1',
              lastModified: 'Mon, 21 Jul 2026 10:00:00 GMT',
            }),
          ),
          fetcher,
        }),
      );

      expect(fetcher).toHaveBeenCalledOnce();
      expect(result.source).toBe('cache');
      expect(result.catalog.catalogVersion).toBe('cached');
      expect(result.warning).toBeNull();
      expect(result.network).toBe('not-modified');
    });

    it('prefers a newer bundled catalog over an older cache on 304', async () => {
      const result = await loadContentModuleCatalog(
        options({
          bundledCatalog: catalog('bundled', '2026-08-01T00:00:00Z'),
          cache: cache(record({ catalog: catalog('cached', NEWER), etag: 'etag-1' })),
          fetcher: async () => response({ status: 304 }),
        }),
      );

      expect(result.source).toBe('bundled');
      expect(result.catalog.catalogVersion).toBe('bundled');
    });

    it('prefers a newer bundled catalog over an older cache when the fetch fails', async () => {
      const result = await loadContentModuleCatalog(
        options({
          bundledCatalog: catalog('bundled', '2026-08-01T00:00:00Z'),
          cache: cache(record({ catalog: catalog('cached', NEWER), etag: 'etag-1' })),
          fetcher: async () => {
            throw new Error('offline');
          },
        }),
      );

      expect(result.source).toBe('bundled');
      expect(result.warning).toBe('offline');
      expect(result.network).toBe('failed');
    });

    it('keeps a newer cache over the bundled catalog when the fetch fails', async () => {
      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER), etag: 'etag-1' })),
          fetcher: async () => {
            throw new Error('offline');
          },
        }),
      );

      expect(result.source).toBe('cache');
      expect(result.catalog.catalogVersion).toBe('cached');
      expect(result.warning).toBe('offline');
    });

    it('keeps a stale cache usable when remote JSON is invalid', async () => {
      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER) })),
          fetcher: async () => response({ status: 200, body: { broken: true } }),
        }),
      );

      expect(result.source).toBe('cache');
      expect(result.catalog.catalogVersion).toBe('cached');
      expect(result.warning).toBeTruthy();
    });

    it('resolves the newest of bundled, cached and remote on a fresh download', async () => {
      const newest = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER) })),
          fetcher: async () =>
            response({ status: 200, body: catalog('remote', '2026-09-01T00:00:00Z') }),
        }),
      );
      expect(newest.source).toBe('remote');

      const cacheWins = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', '2026-09-01T00:00:00Z') })),
          fetcher: async () => response({ status: 200, body: catalog('remote', NEWER) }),
        }),
      );
      expect(cacheWins.source).toBe('cache');
      expect(cacheWins.catalog.catalogVersion).toBe('cached');
      expect(cacheWins.warning).toContain('устарел');
    });

    it('lets a freshly fetched remote beat a cache of the same date', async () => {
      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER) })),
          fetcher: async () => response({ status: 200, body: catalog('remote', NEWER) }),
        }),
      );

      expect(result.source).toBe('remote');
    });
  });

  describe('cache records that cannot be trusted', () => {
    it('revalidates a record written by another app version: no validators, no stale 304', async () => {
      const fetcher = vi.fn(
        async (_url: string, init: { headers: Readonly<Record<string, string>> }) => {
          expect(init.headers['If-None-Match']).toBeUndefined();
          expect(init.headers['If-Modified-Since']).toBeUndefined();
          return response({ status: 200, body: catalog('remote', '2026-09-01T00:00:00Z') });
        },
      );

      const result = await loadContentModuleCatalog(
        options({
          cache: cache(
            record({ catalog: catalog('cached', NEWER), etag: 'etag-1', appVersion: '0.6.51' }),
          ),
          fetcher,
        }),
      );

      expect(result.source).toBe('remote');
    });

    it('still serves the other-version catalog while offline, if it is the newest', async () => {
      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER), appVersion: '0.6.51' })),
          fetcher: async () => {
            throw new Error('offline');
          },
        }),
      );

      expect(result.source).toBe('cache');
    });

    it('treats a 304 without trusted validators as an error and falls back locally', async () => {
      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER), appVersion: '0.6.51' })),
          fetcher: async () => response({ status: 304 }),
        }),
      );

      expect(result.network).toBe('failed');
      expect(result.warning).toContain('304');
    });

    it('drops a record of another cache format', async () => {
      const fetcher = vi.fn(
        async (_url: string, init: { headers: Readonly<Record<string, string>> }) => {
          expect(init.headers['If-None-Match']).toBeUndefined();
          throw new Error('offline');
        },
      );

      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER), etag: 'etag-1', format: 1 })),
          fetcher,
        }),
      );

      expect(result.source).toBe('bundled');
    });

    it('drops a record whose catalog no longer passes the schema', async () => {
      const result = await loadContentModuleCatalog(
        options({
          cache: {
            async read() {
              return { ...record({ catalog: null }), catalog: { invalid: true }, etag: 'e' };
            },
            async write() {},
          },
          fetcher: async () => {
            throw new Error('offline');
          },
        }),
      );

      expect(result.source).toBe('bundled');
    });

    it('does not trust validators of a body-less record once the bundled catalog is older', async () => {
      // The record says "remote was 2026-08-01, body not kept" but this app ships an older catalog.
      const fetcher = vi.fn(
        async (_url: string, init: { headers: Readonly<Record<string, string>> }) => {
          expect(init.headers['If-None-Match']).toBeUndefined();
          return response({ status: 200, body: catalog('remote', '2026-08-01T00:00:00Z') });
        },
      );

      const result = await loadContentModuleCatalog(
        options({
          cache: cache(
            record({ catalog: null, publishedAt: '2026-08-01T00:00:00Z', etag: 'etag-1' }),
          ),
          fetcher,
        }),
      );

      expect(result.source).toBe('remote');
    });

    it('uses validators of a body-less record while the bundled catalog covers it', async () => {
      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: null, publishedAt: BUNDLED_DATE, etag: 'etag-1' })),
          fetcher: async (_url, init) => {
            expect(init.headers['If-None-Match']).toBe('etag-1');
            return response({ status: 304 });
          },
        }),
      );

      expect(result.source).toBe('bundled');
      expect(result.network).toBe('not-modified');
    });
  });

  describe('metered connections', () => {
    it('does not download without validators', async () => {
      const fetcher = vi.fn();

      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER), etag: null })),
          allowFullDownload: false,
          fetcher,
        }),
      );

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.network).toBe('skipped-metered');
      expect(result.source).toBe('cache');
      expect(result.warning).toBeNull();
    });

    it('revalidates with a conditional request and a 304 costs no download', async () => {
      const fetcher = vi.fn(async () => response({ status: 304 }));

      const result = await loadContentModuleCatalog(
        options({
          cache: cache(record({ catalog: catalog('cached', NEWER), etag: 'etag-1' })),
          allowFullDownload: false,
          fetcher,
        }),
      );

      expect(fetcher).toHaveBeenCalledOnce();
      expect(result.network).toBe('not-modified');
      expect(result.catalog.catalogVersion).toBe('cached');
    });

    it('does not trust validators from another app version', async () => {
      const fetcher = vi.fn();

      const result = await loadContentModuleCatalog(
        options({
          cache: cache(
            record({ catalog: catalog('cached', NEWER), etag: 'etag-1', appVersion: '0.6.51' }),
          ),
          allowFullDownload: false,
          fetcher,
        }),
      );

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.network).toBe('skipped-metered');
    });
  });

  it('uses bundled catalog when network and cache are unavailable', async () => {
    const result = await loadContentModuleCatalog(
      options({
        fetcher: async () => {
          throw new Error('offline');
        },
      }),
    );

    expect(result.source).toBe('bundled');
    expect(result.catalog.catalogVersion).toBe('bundled');
    expect(result.warning).toBe('offline');
  });

  it('ignores malformed cache records', async () => {
    const result = await loadContentModuleCatalog(
      options({
        cache: {
          async read(): Promise<unknown> {
            return { catalog: { invalid: true } };
          },
          async write(): Promise<void> {},
        },
        fetcher: async () => {
          throw new Error('offline');
        },
      }),
    );

    expect(result.source).toBe('bundled');
  });

  it('reports a cache that cannot be read or written instead of swallowing the error', async () => {
    const failures: Array<[string, unknown]> = [];
    const readError = new Error('read failed');
    const writeError = new Error('QuotaExceededError');

    const result = await loadContentModuleCatalog(
      options({
        cache: {
          async read(): Promise<unknown> {
            throw readError;
          },
          async write(): Promise<void> {
            throw writeError;
          },
        },
        fetcher: async () => response({ status: 200, body: catalog('remote', NEWER) }),
        onCacheFailure: (stage, cause) => failures.push([stage, cause]),
      }),
    );

    expect(result.source).toBe('remote');
    expect(failures).toEqual([
      ['read', readError],
      ['write', writeError],
    ]);
  });
});
