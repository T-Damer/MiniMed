import { describe, expect, it, vi } from 'vitest';

import { createBrowserCatalogFetcher, createNativeCatalogFetcher } from './catalog-fetcher';

describe('native catalog fetcher', () => {
  it('sends validators through the native client and reads the ETag back', async () => {
    const request = vi.fn(async () => ({
      status: 200,
      data: '{"catalogVersion":"x"}',
      headers: { ETag: 'W/"abc"', 'Last-Modified': 'Tue, 06 Oct 2026 10:00:00 GMT' },
    }));
    const fetcher = createNativeCatalogFetcher({ request });

    const response = await fetcher('https://example.test/catalog.json', {
      headers: { Accept: 'application/json', 'If-None-Match': 'W/"old"' },
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.test/catalog.json',
        method: 'GET',
        responseType: 'text',
        headers: { Accept: 'application/json', 'If-None-Match': 'W/"old"' },
      }),
    );
    expect(response.ok).toBe(true);
    expect(response.headers.get('etag')).toBe('W/"abc"');
    expect(response.headers.get('last-modified')).toContain('06 Oct 2026');
    expect(await response.json()).toEqual({ catalogVersion: 'x' });
  });

  it('passes a 304 through without a body', async () => {
    const fetcher = createNativeCatalogFetcher({
      request: async () => ({ status: 304, data: '', headers: {} }),
    });

    const response = await fetcher('https://example.test/catalog.json', { headers: {} });

    expect(response.status).toBe(304);
    expect(response.ok).toBe(false);
    expect(response.headers.get('etag')).toBeNull();
  });

  it('accepts a body the bridge already parsed', async () => {
    const fetcher = createNativeCatalogFetcher({
      request: async () => ({ status: 200, data: { catalogVersion: 'parsed' }, headers: {} }),
    });

    const response = await fetcher('https://example.test/catalog.json', { headers: {} });

    expect(await response.json()).toEqual({ catalogVersion: 'parsed' });
  });

  it('lets a native failure reach the loader instead of hiding it', async () => {
    const fetcher = createNativeCatalogFetcher({
      request: async () => {
        throw new Error('Unable to resolve host');
      },
    });

    await expect(fetcher('https://example.test/catalog.json', { headers: {} })).rejects.toThrow(
      'Unable to resolve host',
    );
  });
});

describe('browser catalog fetcher', () => {
  it('asks the browser to revalidate and sends no credentials or referrer', async () => {
    const fetchImplementation = vi.fn(async () => new Response('{}'));
    const fetcher = createBrowserCatalogFetcher(fetchImplementation as unknown as typeof fetch);

    await fetcher('https://example.test/catalog.json', { headers: { Accept: 'application/json' } });

    expect(fetchImplementation).toHaveBeenCalledWith('https://example.test/catalog.json', {
      headers: { Accept: 'application/json' },
      cache: 'no-cache',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });
});
