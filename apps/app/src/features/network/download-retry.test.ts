import { describe, expect, it, vi } from 'vitest';

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
    expect(isTransientDownloadError(new Error('Сервер ответил HTTP 503.'))).toBe(true);
    expect(isTransientDownloadError(new Error('Сервер ответил HTTP 429.'))).toBe(true);
    expect(isTransientDownloadError(new Error('Размер файла не совпал: 10 != 20.'))).toBe(true);
  });

  it('never retries an abort or a permanent failure', () => {
    expect(isTransientDownloadError(new DOMException('Download aborted.', 'AbortError'))).toBe(
      false,
    );
    expect(isTransientDownloadError(new Error('Сервер ответил HTTP 404.'))).toBe(false);
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

  it('fails fast on a permanent status instead of burning retries', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);

    await expect(
      downloadWithRetry({
        url: 'https://example.com/missing.gguf',
        cacheKey: 'sha256:missing',
        retryDelaysMs: NO_DELAYS,
      }),
    ).rejects.toThrow(/HTTP 404/u);

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
