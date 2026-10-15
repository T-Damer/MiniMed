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

  it('clears only resumable records matching an obsolete cache-key prefix', async () => {
    const store = new Map<string, PartialRecord>();
    const url = 'https://example.com/model.onnx';
    seedPartialDownload(store, {
      key: 'speech:transformers-whisper-q8-v1:base',
      url,
      bytes: [1],
      totalBytes: 4,
    });
    seedPartialDownload(store, {
      key: 'speech:transformers-whisper-q8-v1:small',
      url,
      bytes: [2],
      totalBytes: 4,
    });
    seedPartialDownload(store, {
      key: 'speech:transformers-whisper-q8-v2-pinned-cache:base',
      url,
      bytes: [3],
      totalBytes: 4,
    });
    seedPartialDownload(store, {
      key: 'document:unrelated',
      url,
      bytes: [4],
      totalBytes: 4,
    });
    installIndexedDbDouble(store);

    const { clearResumableDownloadsByPrefix } = await import(
      '@/features/network/resumable-download'
    );
    await expect(
      clearResumableDownloadsByPrefix('speech:transformers-whisper-q8-v1:'),
    ).resolves.toBe(2);

    expect([...store.keys()].toSorted()).toEqual([
      'document:unrelated',
      'speech:transformers-whisper-q8-v2-pinned-cache:base',
    ]);
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
  it('drops a stored partial whose file can no longer be read and fetches from the first byte', async () => {
    const url = 'https://example.com/module.db';
    const store = new Map<string, PartialRecord>();
    seedPartial(store, url, [1, 2]);
    // The row is there, its backing file is not: every read of the handle fails (NotReadableError).
    const damaged = store.get('sha256:abc');
    if (!damaged) throw new Error('The seeded partial is missing.');
    const unreadable = {
      size: 2,
      slice: () => ({
        arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')),
      }),
    } as unknown as Blob;
    store.set('sha256:abc', { ...damaged, data: unreadable });
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rangeHeaderOf(fetchMock, 0)).toBeUndefined();
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(store.has('sha256:abc')).toBe(false);
  });

  it('restarts once when the finished bytes cannot be read back, instead of failing the module', async () => {
    const url = 'https://example.com/module.db';
    const store = new Map<string, PartialRecord>();
    installIndexedDbDouble(store);
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const read = vi
      .spyOn(Blob.prototype, 'arrayBuffer')
      .mockRejectedValueOnce(new DOMException('gone', 'NotReadableError'));

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    // `flushBytes: 1` stores the bytes as they arrive, so the finished file is read back from a Blob.
    const bytes = await downloadWithResume({
      url,
      cacheKey: 'sha256:abc',
      expectedBytes: 4,
      flushBytes: 1,
    });
    read.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(store.has('sha256:abc')).toBe(false);
  });

  it('gives up after one restart so a permanently unreadable store cannot loop', async () => {
    const url = 'https://example.com/module.db';
    installIndexedDbDouble(new Map<string, PartialRecord>());
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const read = vi
      .spyOn(Blob.prototype, 'arrayBuffer')
      .mockRejectedValue(new DOMException('gone', 'NotReadableError'));

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    await expect(
      downloadWithResume({ url, cacheKey: 'sha256:abc', expectedBytes: 4, flushBytes: 1 }),
    ).rejects.toMatchObject({ name: 'NotReadableError' });
    read.mockRestore();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps a small file in memory and never stores or wraps it in a Blob', async () => {
    const store = new Map<string, PartialRecord>();
    installIndexedDbDouble(store);
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer');

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    const bytes = await downloadWithResume({
      url: 'https://example.com/module.db',
      cacheKey: 'sha256:abc',
      expectedBytes: 4,
    });

    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(read).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    read.mockRestore();
  });
  it('keeps downloading in memory when the device is too full to store the partial', async () => {
    // Every write transaction is aborted with QuotaExceededError; reads and deletes work.
    const database = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => undefined,
      close: () => undefined,
      transaction: () => {
        const transaction: {
          oncomplete: (() => void) | null;
          onerror: (() => void) | null;
          onabort: (() => void) | null;
          error: DOMException | null;
          objectStore: () => unknown;
        } = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
          objectStore: () => ({
            get: () => {
              const request: { result: undefined; onsuccess: (() => void) | null } = {
                result: undefined,
                onsuccess: null,
              };
              setTimeout(() => request.onsuccess?.(), 0);
              setTimeout(() => transaction.oncomplete?.(), 5);
              return request;
            },
            put: () => {
              setTimeout(() => {
                transaction.error = new DOMException('The device is full.', 'QuotaExceededError');
                transaction.onabort?.();
              }, 0);
            },
            delete: () => {
              setTimeout(() => transaction.oncomplete?.(), 0);
            },
          }),
        };
        return transaction;
      },
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: { result: unknown; onsuccess: (() => void) | null } = {
          result: database,
          onsuccess: null,
        };
        setTimeout(() => request.onsuccess?.(), 0);
        return request;
      },
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { downloadWithResume } = await import('@/features/network/resumable-download');
    const bytes = await downloadWithResume({
      url: 'https://example.com/module.db',
      cacheKey: 'sha256:abc',
      expectedBytes: 4,
      flushBytes: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });
});
