import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { ContentModuleCatalogFetcher, ContentModuleCatalogResponse } from '@localmed/core';

/**
 * How the app asks for the remote module catalog.
 *
 * The catalog lives on raw.githubusercontent.com, which a page may read but not question: its
 * answers do not expose `ETag`, and its CORS preflight refuses `If-None-Match`. So Android uses the
 * native HTTP client (no CORS, validators sent and read back, an unchanged catalog costs a 304),
 * and the browser uses `fetch` with `cache: 'no-cache'`, which makes the browser's own HTTP cache
 * revalidate the stored copy with its validators instead of trusting a five-minute freshness.
 */
export interface NativeCatalogHttp {
  request(options: {
    readonly url: string;
    readonly method: 'GET';
    readonly headers: Record<string, string>;
    readonly responseType: 'text';
    readonly connectTimeout: number;
    readonly readTimeout: number;
  }): Promise<{
    readonly status: number;
    readonly data: unknown;
    readonly headers: Record<string, string>;
  }>;
}

const NATIVE_TIMEOUT_MS = 60_000;

function lowerCaseHeaders(headers: Record<string, string> | undefined): Map<string, string> {
  const lower = new Map<string, string>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') lower.set(name.toLowerCase(), value);
  }
  return lower;
}

export function createNativeCatalogFetcher(
  http: NativeCatalogHttp = CapacitorHttp as unknown as NativeCatalogHttp,
): ContentModuleCatalogFetcher {
  return async (url, init): Promise<ContentModuleCatalogResponse> => {
    const result = await http.request({
      url,
      method: 'GET',
      headers: { ...init.headers },
      responseType: 'text',
      connectTimeout: NATIVE_TIMEOUT_MS,
      readTimeout: NATIVE_TIMEOUT_MS,
    });
    const headers = lowerCaseHeaders(result.headers);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      // A JSON content type may arrive already parsed from the bridge.
      json: async () => (typeof result.data === 'string' ? JSON.parse(result.data) : result.data),
    };
  };
}

export function createBrowserCatalogFetcher(
  fetchImplementation: typeof fetch = (...args) => globalThis.fetch(...args),
): ContentModuleCatalogFetcher {
  return (url, init) =>
    fetchImplementation(url, {
      headers: init.headers,
      cache: 'no-cache',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
}

export function createCatalogFetcher(): ContentModuleCatalogFetcher {
  return Capacitor.isNativePlatform()
    ? createNativeCatalogFetcher()
    : createBrowserCatalogFetcher();
}
