import { describe, expect, it, vi } from 'vitest';

import {
  getDownloadQueue,
  resetDownloadQueueForTests,
} from '@/features/downloads/download-service';
import { downloadWithRetry, isTransientDownloadError } from '@/features/network/download-retry';
import {
  installIndexedDbDouble,
  type PartialDownloadRecordDouble,
  rangeHeaderOfCall,
} from '@/features/network/indexeddb-test-double';

const NO_DELAYS = [0, 0, 0] as const;

function payloadResponse(payload: Uint8Array<ArrayBuffer>): Response {
  return new Response(payload, {
    status: 200,
    headers: { 'content-length': String(payload.byteLength) },
  });
}

describe('isTransientDownloadError', () => {
  it('recognizes the fetch failures each browser engine reports', () => {
    expect(isTransientDownloadError(new TypeError('Failed to fetch'))).toBe(true);
    expect(
      isTransientDownloadError(new TypeError('NetworkError when attempting to fetch resource.')),
    ).toBe(true);
    expect(isTransientDownloadError(new TypeError('Load failed'))).toBe(true);
    expect(isTransientDownloadError(new Error('network error'))).toBe(true);
  });

  it('recognizes retryable transport statuses raised in Russian', () => {
    expect(isTransientDownloadError(new Error('Сервер ответил HTTP 404.'))).toBe(true);
    expect(isTransientDownloadError(new Error('Сервер ответил HTTP 503.'))).toBe(true);
    expect(isTransientDownloadError(new Error('Сервер ответил HTTP 429.'))).toBe(true);
    expect(isTransientDownloadError(new Error('Размер файла не совпал: 10 != 20.'))).toBe(true);
    expect(isTransientDownloadError(new Error('Ошибка из-за нестабильной сети.'))).toBe(true);
  });

  it('retries a stored file that could not be read, by name or by the installer message', () => {
    expect(isTransientDownloadError(new DOMException('gone', 'NotReadableError'))).toBe(true);
    expect(
      isTransientDownloadError(
        new Error(
          'The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.',
        ),
      ),
    ).toBe(true);
  });

  it('never retries an abort or a permanent failure', () => {
    expect(isTransientDownloadError(new DOMException('Download aborted.', 'AbortError'))).toBe(
      false,
    );
    expect(isTransientDownloadError(new Error('Сжатые наборы пока не поддерживаются.'))).toBe(
      false,
    );
    expect(isTransientDownloadError('network error')).toBe(false);
  });
});

describe('downloadWithRetry', () => {
  it('recovers from a transient failure without surfacing it', async () => {
    const payload = new Uint8Array([7, 8, 9]);
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(payloadResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);

    const bytes = await downloadWithRetry({
      url: 'https://example.com/model.gguf',
      cacheKey: 'sha256:model',
      expectedBytes: payload.byteLength,
      retryDelaysMs: NO_DELAYS,
    });

    expect([...bytes]).toEqual([...payload]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('reports an actionable message once the retry budget is exhausted', async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);

    await expect(
      downloadWithRetry({
        url: 'https://example.com/model.gguf',
        cacheKey: 'sha256:model',
        retryDelaysMs: NO_DELAYS,
      }),
    ).rejects.toThrow(/нестабильной сети/u);

    expect(fetchMock).toHaveBeenCalledTimes(1 + NO_DELAYS.length);
    vi.unstubAllGlobals();
  });

  it('keeps retrying transient failures when recovery is requested', async () => {
    const payload = new Uint8Array([7, 8, 9]);
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(payloadResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);

    const bytes = await downloadWithRetry({
      url: 'https://example.com/model.gguf',
      cacheKey: 'sha256:model',
      expectedBytes: payload.byteLength,
      retryDelaysMs: [0],
      retryForever: true,
    });

    expect([...bytes]).toEqual([...payload]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    vi.unstubAllGlobals();
  });

  it('retries a release asset that is temporarily missing', async () => {
    const payload = new Uint8Array([7, 8, 9]);
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(payloadResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);

    const bytes = await downloadWithRetry({
      url: 'https://example.com/publishing.gguf',
      cacheKey: 'sha256:publishing',
      expectedBytes: payload.byteLength,
      retryDelaysMs: NO_DELAYS,
    });

    expect([...bytes]).toEqual([...payload]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('does not retry a missing asset when it is known to be published already', async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);

    await expect(
      downloadWithRetry({
        url: 'https://example.com/published.gguf',
        cacheKey: 'sha256:published',
        retryMissingAssets: false,
        retryDelaysMs: NO_DELAYS,
      }),
    ).rejects.toThrow('HTTP 404');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('resumes from the bytes it kept when a transfer drops mid-download', async () => {
    const store = new Map<string, PartialDownloadRecordDouble>();
    // Slow writes on purpose: the retry starts immediately, so the download must wait for its partial
    // bytes to land. A fire-and-forget flush loses this race and restarts from zero.
    installIndexedDbDouble(store, { writeDelayMs: 25 });

    // First attempt delivers two bytes and then the connection dies; the retry must ask for the rest.
    let delivered = false;
    const droppingBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!delivered) {
          delivered = true;
          controller.enqueue(new Uint8Array([1, 2]));
          return;
        }
        controller.error(new TypeError('Failed to fetch'));
      },
    });
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(droppingBody, { status: 200, headers: { 'content-length': '4' } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([3, 4]), {
          status: 206,
          headers: { 'content-range': 'bytes 2-3/4', 'content-length': '2' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await downloadWithRetry({
      url: 'https://example.com/model.gguf',
      cacheKey: 'sha256:model',
      expectedBytes: 4,
      retryDelaysMs: NO_DELAYS,
    });

    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(rangeHeaderOfCall(fetchMock.mock.calls, 1)).toBe('bytes=2-');
    expect(store.has('sha256:model')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('stops retrying when the doctor cancels the download', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);

    await expect(
      downloadWithRetry({
        url: 'https://example.com/model.gguf',
        cacheKey: 'sha256:model',
        signal: controller.signal,
        retryDelaysMs: NO_DELAYS,
      }),
    ).rejects.toThrow(/Failed to fetch/u);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('pausing a module download', () => {
  it('stops the transfer without failing it and continues from the bytes already received', async () => {
    const store = new Map<string, PartialDownloadRecordDouble>();
    installIndexedDbDouble(store);
    const queue = getDownloadQueue();
    const jobId = 'module:pause-test@1';
    queue.observe(
      { id: jobId, kind: 'module', title: 'Набор', totalBytes: 4 },
      { state: 'queued' },
      {},
    );

    // The first response delivers two bytes and then stalls until the request is aborted.
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(async (_url, init) => {
        let delivered = false;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!delivered) {
              delivered = true;
              controller.enqueue(new Uint8Array([1, 2]));
              return new Promise<void>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () =>
                  reject(new DOMException('Download aborted.', 'AbortError')),
                );
              });
            }
            return undefined;
          },
        });
        return new Response(body, { status: 200, headers: { 'content-length': '4' } });
      })
      .mockResolvedValueOnce(
        new Response(new Uint8Array([3, 4]), {
          status: 206,
          headers: { 'content-range': 'bytes 2-3/4', 'content-length': '2' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const download = downloadWithRetry({
      jobId,
      url: 'https://example.com/module.sqlite',
      cacheKey: 'sha256:pause-test',
      expectedBytes: 4,
      retryDelaysMs: NO_DELAYS,
    });
    let settled = false;
    void download.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.waitFor(() => expect(queue.get(jobId)?.state).toBe('downloading'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    queue.setPaused(true);
    await vi.waitFor(() => expect(queue.get(jobId)?.state).toBe('paused'));
    await vi.waitFor(() => expect(store.get('sha256:pause-test')?.data.size).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false); // still pending, not failed
    expect(fetchMock).toHaveBeenCalledTimes(1);

    queue.setPaused(false);
    const bytes = await download;
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rangeHeaderOfCall(fetchMock.mock.calls, 1)).toBe('bytes=2-');
    expect(store.has('sha256:pause-test')).toBe(false);
    vi.unstubAllGlobals();
    await resetDownloadQueueForTests();
  });
});
