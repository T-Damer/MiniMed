import { afterEach, describe, expect, it, vi } from 'vitest';

describe('downloadWithResume', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('downloads the full payload when no partial cache exists', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(
      async () =>
        new Response(payload, {
          status: 200,
          headers: { 'content-length': String(payload.byteLength) },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    const bytes = await downloadWithResume({
      url: 'https://example.com/module.db',
      cacheKey: 'sha256:abc',
      expectedBytes: payload.byteLength,
    });

    expect([...bytes]).toEqual([...payload]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as ReadonlyArray<readonly [string, RequestInit?]>;
    expect(calls[0]?.[1]?.headers).toBeUndefined();
  });
});
