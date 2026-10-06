import { type ContentModuleCatalog, ContentModuleCatalogSchema } from '@localmed/contracts';

export type ContentModuleCatalogSource = 'remote' | 'cache' | 'bundled';

/** Bumped whenever the shape of a stored record changes; records of another format are dropped. */
export const CONTENT_MODULE_CATALOG_CACHE_FORMAT = 2;

/**
 * What the last successful remote fetch left on the device. `catalog` is the remote catalog as
 * fetched, and it is stored only when it was newer than the bundled one at that time: a remote
 * that merely equals the shipped catalog would duplicate megabytes for nothing, so only its
 * validators and `publishedAt` are kept (`catalog: null`).
 */
export interface ContentModuleCatalogCacheRecord {
  readonly format: number;
  /** The app version that wrote the record; validators from another version are not trusted. */
  readonly appVersion: string;
  readonly catalog: ContentModuleCatalog | null;
  /** `publishedAt` of the remote catalog these validators belong to. */
  readonly publishedAt: string;
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

export type ContentModuleCatalogCacheStage = 'read' | 'write';

export interface LoadContentModuleCatalogOptions {
  readonly bundledCatalog: ContentModuleCatalog;
  readonly remoteUrl: string;
  readonly cache: ContentModuleCatalogCache;
  /** The running app's version; a cache written by another version is revalidated, not trusted. */
  readonly appVersion: string;
  readonly fetcher?: ContentModuleCatalogFetcher;
  readonly now?: () => string;
  /**
   * When false (a metered connection where the user has not asked for a refresh) the remote is
   * contacted only if the cache holds validators, so an unchanged catalog costs a 304 and never a
   * full download. Defaults to true.
   */
  readonly allowFullDownload?: boolean;
  /** Called for a cache that could not be read or written; the load carries on without it. */
  readonly onCacheFailure?: (stage: ContentModuleCatalogCacheStage, cause: unknown) => void;
}

/** What the network did during one load. */
export type ContentModuleCatalogNetwork =
  | 'downloaded'
  | 'not-modified'
  | 'skipped-metered'
  | 'failed';

export interface LoadedContentModuleCatalog {
  readonly catalog: ContentModuleCatalog;
  /** The newest of bundled, cached and remote catalogs. */
  readonly source: ContentModuleCatalogSource;
  readonly checkedAt: string;
  readonly warning: string | null;
  readonly network: ContentModuleCatalogNetwork;
}

function parseCacheRecord(value: unknown): ContentModuleCatalogCacheRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Readonly<Record<string, unknown>>;
  if (source['format'] !== CONTENT_MODULE_CATALOG_CACHE_FORMAT) return null;
  const appVersion = source['appVersion'];
  const publishedAt = source['publishedAt'];
  const etag = source['etag'];
  const lastModified = source['lastModified'];
  const fetchedAt = source['fetchedAt'];
  if (typeof appVersion !== 'string' || appVersion.length === 0) return null;
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) return null;
  if (etag !== null && typeof etag !== 'string') return null;
  if (lastModified !== null && typeof lastModified !== 'string') return null;
  if (typeof fetchedAt !== 'string' || fetchedAt.length === 0) return null;
  let catalog: ContentModuleCatalog | null = null;
  if (source['catalog'] !== null) {
    const parsedCatalog = ContentModuleCatalogSchema.safeParse(source['catalog']);
    if (!parsedCatalog.success) return null;
    catalog = parsedCatalog.data;
  }
  return {
    format: CONTENT_MODULE_CATALOG_CACHE_FORMAT,
    appVersion,
    catalog,
    publishedAt,
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

export function catalogLoadWarningFromCause(cause: unknown): string {
  if (isCatalogValidationFailure(cause)) {
    return 'Удалённый каталог не прошёл проверку; используется встроенный.';
  }
  if (cause instanceof Error && cause.message.trim().length > 0) {
    if (looksLikeSerializedZodIssues(cause.message)) {
      return 'Удалённый каталог не прошёл проверку; используется встроенный.';
    }
    return cause.message;
  }
  return 'Не удалось обновить каталог модулей.';
}

function isCatalogValidationFailure(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause as { name: unknown }).name === 'ZodError' &&
    'issues' in cause &&
    Array.isArray((cause as { issues: unknown }).issues)
  );
}

function looksLikeSerializedZodIssues(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed.startsWith('[')) return false;
  return trimmed.includes('"code"') && trimmed.includes('"path"');
}

function publishedMs(catalog: ContentModuleCatalog): number {
  return Date.parse(catalog.publishedAt);
}

interface Candidate {
  readonly catalog: ContentModuleCatalog;
  readonly source: ContentModuleCatalogSource;
}

/**
 * The newest candidate by `publishedAt`. Ties keep the established order: the bundled catalog
 * beats a remote one that is not strictly newer, and a freshly fetched remote beats the cache.
 */
function newestCandidate(candidates: readonly Candidate[]): Candidate {
  let best = candidates[0] as Candidate;
  for (const candidate of candidates.slice(1)) {
    if (publishedMs(candidate.catalog) > publishedMs(best.catalog)) best = candidate;
  }
  return best;
}

const SOURCE_LABEL: Readonly<Record<ContentModuleCatalogSource, string>> = {
  bundled: 'встроенный',
  cache: 'сохранённый',
  remote: 'удалённый',
};

export async function loadContentModuleCatalog(
  options: LoadContentModuleCatalogOptions,
): Promise<LoadedContentModuleCatalog> {
  const bundled = ContentModuleCatalogSchema.parse(options.bundledCatalog);
  const now = options.now ?? (() => new Date().toISOString());
  const fetcher = options.fetcher ?? defaultFetcher;
  const allowFullDownload = options.allowFullDownload ?? true;

  let cached: ContentModuleCatalogCacheRecord | null = null;
  try {
    cached = parseCacheRecord(await options.cache.read());
  } catch (cause) {
    options.onCacheFailure?.('read', cause);
  }

  // Validators are worth sending only when a 304 would leave us with a catalog we can use: the
  // record must come from this app version, and either hold the catalog or describe a remote that
  // the bundled catalog already covers (it was stored without its body for exactly that reason).
  const bundledCoversCached =
    cached !== null && Date.parse(cached.publishedAt) <= publishedMs(bundled);
  const validators =
    cached !== null &&
    cached.appVersion === options.appVersion &&
    (cached.catalog !== null || bundledCoversCached)
      ? cached
      : null;
  const usableCached = cached?.catalog ?? null;

  const bundledCandidate: Candidate = { catalog: bundled, source: 'bundled' };
  const cachedCandidates: Candidate[] = usableCached
    ? [{ catalog: usableCached, source: 'cache' }]
    : [];
  const resolveLocal = (): Candidate => newestCandidate([bundledCandidate, ...cachedCandidates]);

  const hasValidators = Boolean(validators?.etag || validators?.lastModified);
  if (!allowFullDownload && !hasValidators) {
    const local = resolveLocal();
    return {
      catalog: local.catalog,
      source: local.source,
      checkedAt: now(),
      warning: null,
      network: 'skipped-metered',
    };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (validators?.etag) headers['If-None-Match'] = validators.etag;
  if (validators?.lastModified) headers['If-Modified-Since'] = validators.lastModified;

  try {
    const response = await fetcher(options.remoteUrl, { headers });
    if (response.status === 304) {
      if (!validators) throw new Error('GitHub вернул 304, но локальный cache отсутствует.');
      const local = resolveLocal();
      return {
        catalog: local.catalog,
        source: local.source,
        checkedAt: now(),
        warning: null,
        network: 'not-modified',
      };
    }
    if (!response.ok) throw new Error(`Каталог модулей недоступен: HTTP ${response.status}.`);

    const remote = ContentModuleCatalogSchema.parse(await response.json());
    const checkedAt = now();
    const resolved = newestCandidate([
      bundledCandidate,
      { catalog: remote, source: 'remote' },
      ...cachedCandidates,
    ]);
    const record: ContentModuleCatalogCacheRecord = {
      format: CONTENT_MODULE_CATALOG_CACHE_FORMAT,
      appVersion: options.appVersion,
      catalog: publishedMs(remote) > publishedMs(bundled) ? remote : null,
      publishedAt: remote.publishedAt,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      fetchedAt: checkedAt,
    };
    try {
      await options.cache.write(record);
    } catch (cause) {
      // A valid remote catalog remains usable even when cache persistence fails.
      options.onCacheFailure?.('write', cause);
    }
    const remoteIsOlder = publishedMs(remote) < publishedMs(resolved.catalog);
    return {
      catalog: resolved.catalog,
      source: resolved.source,
      checkedAt,
      warning: remoteIsOlder
        ? `Удалённый каталог устарел; используется ${SOURCE_LABEL[resolved.source]}.`
        : null,
      network: 'downloaded',
    };
  } catch (cause) {
    const local = resolveLocal();
    return {
      catalog: local.catalog,
      source: local.source,
      checkedAt: now(),
      warning: catalogLoadWarningFromCause(cause),
      network: 'failed',
    };
  }
}
