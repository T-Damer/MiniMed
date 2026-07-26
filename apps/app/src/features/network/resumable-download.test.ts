import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installIndexedDbDouble,
  type PartialDownloadRecordDouble as PartialRecord,
  rangeHeaderOfCall,
  seedPartialDownload,
} from '@/features/network/indexeddb-test-double';

function seedPartial(
  store: Map<string, PartialRecord>,
  url: string,
  bytes: readonly number[],
): void {
  seedPartialDownload(store, { key: 'sha256:abc', url, bytes, totalBytes: 4 });
}

function rangeHeaderOf(
  fetchMock: { readonly mock: { readonly calls: unknown[][] } },
  call: number,
): string | undefined {
  return rangeHeaderOfCall(fetchMock.mock.calls, call);
}

async function settleStorageWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

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

  it('resumes a download interrupted by a reload instead of restarting it', async () => {
    const url = 'https://example.com/module.db';
    const store = new Map<string, PartialRecord>();
    seedPartial(store, url, [1, 2]);
    installIndexedDbDouble(store);

    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([3, 4]), {
          status: 206,
          headers: { 'content-range': 'bytes 2-3/4', 'content-length': '2' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    const bytes = await downloadWithResume({ url, cacheKey: 'sha256:abc', expectedBytes: 4 });

    expect(rangeHeaderOf(fetchMock, 0)).toBe('bytes=2-');
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(store.has('sha256:abc')).toBe(false);
  });

  it('keeps the bytes it already received when the transfer dies mid-stream', async () => {
    const url = 'https://example.com/module.db';
    const store = new Map<string, PartialRecord>();
    installIndexedDbDouble(store);

    // The chunk has to be delivered before the failure: erroring a stream discards whatever is still
    // queued, which would model a connection that died before sending anything at all.
    let delivered = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!delivered) {
          delivered = true;
          controller.enqueue(new Uint8Array([1, 2]));
          return;
        }
        controller.error(new TypeError('Failed to fetch'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200, headers: { 'content-length': '4' } })),
    );

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    await expect(
      downloadWithResume({ url, cacheKey: 'sha256:abc', expectedBytes: 4 }),
    ).rejects.toThrow(/Failed to fetch/u);

    await settleStorageWrites();
    const kept = store.get('sha256:abc');
    expect(kept?.data.size).toBe(2);
    expect(kept?.url).toBe(url);
  });

  it('discards a stale partial when the server ignores the range request', async () => {
    const url = 'https://example.com/module.db';
    const store = new Map<string, PartialRecord>();
    seedPartial(store, url, [9, 9]);
    installIndexedDbDouble(store);

    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    const bytes = await downloadWithResume({ url, cacheKey: 'sha256:abc', expectedBytes: 4 });

    expect(rangeHeaderOf(fetchMock, 0)).toBe('bytes=2-');
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });

  it('starts over when the server rejects the stored range', async () => {
    const url = 'https://example.com/module.db';
    const store = new Map<string, PartialRecord>();
    seedPartial(store, url, [1, 2, 3, 4, 5, 6]);
    installIndexedDbDouble(store);

    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 416 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    const bytes = await downloadWithResume({ url, cacheKey: 'sha256:abc', expectedBytes: 4 });

    expect(rangeHeaderOf(fetchMock, 0)).toBe('bytes=6-');
    expect(rangeHeaderOf(fetchMock, 1)).toBeUndefined();
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });
});
