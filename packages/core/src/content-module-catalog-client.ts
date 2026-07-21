import { type ContentModuleCatalog, ContentModuleCatalogSchema } from '@localmed/contracts';

export type ContentModuleCatalogSource = 'remote' | 'cache' | 'bundled';

export interface ContentModuleCatalogCacheRecord {
  readonly catalog: ContentModuleCatalog;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly fetchedAt: string;
}

export interface ContentModuleCatalogCache {
  read(): Promise<unknown | null>;
  write(record: ContentModuleCatalogCacheRecord): Promise<void>;
}

export interface ContentModuleCatalogResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
}

export type ContentModuleCatalogFetcher = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<ContentModuleCatalogResponse>;

export interface LoadContentModuleCatalogOptions {
  readonly bundledCatalog: ContentModuleCatalog;
  readonly remoteUrl: string;
  readonly cache: ContentModuleCatalogCache;
  readonly fetcher?: ContentModuleCatalogFetcher;
  readonly now?: () => string;
}

export interface LoadedContentModuleCatalog {
  readonly catalog: ContentModuleCatalog;
  readonly source: ContentModuleCatalogSource;
  readonly checkedAt: string;
  readonly warning: string | null;
}

function parseCacheRecord(value: unknown): ContentModuleCatalogCacheRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Readonly<Record<string, unknown>>;
  const parsedCatalog = ContentModuleCatalogSchema.safeParse(source['catalog']);
  if (!parsedCatalog.success) return null;
  const etag = source['etag'];
  const lastModified = source['lastModified'];
  const fetchedAt = source['fetchedAt'];
  if (etag !== null && typeof etag !== 'string') return null;
  if (lastModified !== null && typeof lastModified !== 'string') return null;
  if (typeof fetchedAt !== 'string' || fetchedAt.length === 0) return null;
  return {
    catalog: parsedCatalog.data,
    etag,
    lastModified,
    fetchedAt,
  };
}

function defaultFetcher(
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
): Promise<ContentModuleCatalogResponse> {
  return fetch(url, { headers: init.headers });
}

function messageFromCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Не удалось обновить каталог модулей.';
}

export async function loadContentModuleCatalog(
  options: LoadContentModuleCatalogOptions,
): Promise<LoadedContentModuleCatalog> {
  const bundled = ContentModuleCatalogSchema.parse(options.bundledCatalog);
  const now = options.now ?? (() => new Date().toISOString());
  const fetcher = options.fetcher ?? defaultFetcher;

  let cached: ContentModuleCatalogCacheRecord | null = null;
  try {
    cached = parseCacheRecord(await options.cache.read());
  } catch {
    cached = null;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

  try {
    const response = await fetcher(options.remoteUrl, { headers });
    if (response.status === 304) {
      if (!cached) throw new Error('GitHub вернул 304, но локальный cache отсутствует.');
      return {
        catalog: cached.catalog,
        source: 'cache',
        checkedAt: now(),
        warning: null,
      };
    }
    if (!response.ok) throw new Error(`Каталог модулей недоступен: HTTP ${response.status}.`);

    const catalog = ContentModuleCatalogSchema.parse(await response.json());
    const checkedAt = now();
    const record: ContentModuleCatalogCacheRecord = {
      catalog,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      fetchedAt: checkedAt,
    };
    try {
      await options.cache.write(record);
    } catch {
      // A valid remote catalog remains usable even when cache persistence fails.
    }
    return { catalog, source: 'remote', checkedAt, warning: null };
  } catch (cause) {
    const warning = messageFromCause(cause);
    if (cached) {
      return {
        catalog: cached.catalog,
        source: 'cache',
        checkedAt: now(),
        warning,
      };
    }
    return {
      catalog: bundled,
      source: 'bundled',
      checkedAt: now(),
      warning,
    };
  }
}
