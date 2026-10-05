import { describe, expect, it, vi } from 'vitest';

import {
  createNativeTransport,
  createWebTransport,
  decodeFeedBytes,
  FeedFetchError,
  type NativeHttp,
} from '@/features/news/news-transport';

function response(body: string | Uint8Array, init: ResponseInit & { url?: string } = {}): Response {
  const result = new Response(body as BodyInit, init);
  if (init.url) Object.defineProperty(result, 'url', { value: init.url });
  return result;
}

const errorCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
  } catch (error) {
    return error instanceof FeedFetchError ? error.code : 'other';
  }
  return undefined;
};

describe('decodeFeedBytes', () => {
  const win1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // «Привет»

  it('honours the charset of the header, then of the XML prolog, then UTF-8', () => {
    expect(decodeFeedBytes(win1251, 'text/xml; charset=windows-1251')).toBe('Привет');
    const prolog = new TextEncoder().encode('<?xml version="1.0" encoding="windows-1251"?>');
    const bytes = new Uint8Array([...prolog, ...win1251]);
    expect(decodeFeedBytes(bytes, 'text/xml')).toContain('Привет');
    expect(decodeFeedBytes(new TextEncoder().encode('Привет'))).toBe('Привет');
  });

  it('falls back to UTF-8 for an unknown charset label', () => {
    expect(decodeFeedBytes(new TextEncoder().encode('ok'), 'text/xml; charset=nonsense-9')).toBe(
      'ok',
    );
  });
});

describe('web transport', () => {
  it('reads a feed with no credentials, no referrer and no validators', async () => {
    const fetchMock = vi.fn(async () =>
      response('<rss/>', {
        status: 200,
        headers: { 'content-type': 'application/rss+xml', etag: '"x"' },
      }),
    );
    const transport = createWebTransport({
      fetch: fetchMock as unknown as typeof fetch,
      online: () => true,
    });
    const result = await transport.fetch({ url: 'https://a.example/feed', etag: '"old"' });
    expect(result.text).toBe('<rss/>');
    expect(result.headers['etag']).toBe('"x"');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.headers).toBeUndefined();
  });

  it('reports a CORS refusal when the host is reachable without cors but unreadable with it', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.mode === 'no-cors') return response('', { status: 200 });
      throw new TypeError('Failed to fetch');
    });
    const transport = createWebTransport({
      fetch: fetchMock as unknown as typeof fetch,
      online: () => true,
    });
    expect(await errorCode(transport.fetch({ url: 'https://a.example/feed' }))).toBe('cors');
  });

  it('reports a network failure when even the opaque request fails, and offline without trying', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const online = createWebTransport({
      fetch: failing as unknown as typeof fetch,
      online: () => true,
    });
    expect(await errorCode(online.fetch({ url: 'https://a.example/feed' }))).toBe('network');
    failing.mockClear();
    const offline = createWebTransport({
      fetch: failing as unknown as typeof fetch,
      online: () => false,
    });
    expect(await errorCode(offline.fetch({ url: 'https://a.example/feed' }))).toBe('offline');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('maps HTTP errors and oversized bodies', async () => {
    const http = createWebTransport({
      fetch: (async () => response('nope', { status: 503 })) as unknown as typeof fetch,
      online: () => true,
    });
    expect(await errorCode(http.fetch({ url: 'https://a.example/feed' }))).toBe('http');
    const big = createWebTransport({
      fetch: (async () => response('x'.repeat(2000), { status: 200 })) as unknown as typeof fetch,
      online: () => true,
    });
    expect(await errorCode(big.fetch({ url: 'https://a.example/feed', maxBytes: 1000 }))).toBe(
      'too-large',
    );
  });

  it('times out a request that never answers', async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const transport = createWebTransport({
      fetch: hanging as unknown as typeof fetch,
      online: () => true,
    });
    expect(await errorCode(transport.fetch({ url: 'https://a.example/feed', timeoutMs: 30 }))).toBe(
      'timeout',
    );
  });
});

describe('native transport', () => {
  const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

  it('sends validators, decodes the base64 body and follows an http to https redirect', async () => {
    const request = vi.fn<NativeHttp['request']>();
    request.mockResolvedValueOnce({
      status: 301,
      data: '',
      headers: { Location: 'https://a.example/feed' },
      url: '',
    });
    request.mockResolvedValueOnce({
      status: 200,
      data: base64('<rss>Привет</rss>'),
      headers: { 'Content-Type': 'application/rss+xml', ETag: '"v2"' },
      url: '',
    });
    const transport = createNativeTransport({ request }, () => true);
    const result = await transport.fetch({
      url: 'http://a.example/feed',
      etag: '"v1"',
      lastModified: 'Sun, 04 Oct 2026 00:00:00 GMT',
    });
    expect(result.text).toBe('<rss>Привет</rss>');
    expect(result.finalUrl).toBe('https://a.example/feed');
    expect(result.headers['etag']).toBe('"v2"');
    const first = request.mock.calls[0]?.[0];
    expect(first?.headers['If-None-Match']).toBe('"v1"');
    expect(first?.headers['If-Modified-Since']).toBe('Sun, 04 Oct 2026 00:00:00 GMT');
    expect(first?.disableRedirects).toBe(true);
    expect(transport.conditional).toBe(true);
  });

  it('answers not-modified on 304, re-serializes bridge-parsed JSON and rejects error statuses', async () => {
    const notModified = createNativeTransport({
      request: async () => ({ status: 304, data: '', headers: {}, url: '' }),
    });
    expect((await notModified.fetch({ url: 'https://a.example/feed' })).notModified).toBe(true);
    const json = createNativeTransport({
      request: async () => ({
        status: 200,
        data: { version: 'https://jsonfeed.org/version/1.1', items: [] },
        headers: { 'content-type': 'application/json' },
        url: '',
      }),
    });
    expect((await json.fetch({ url: 'https://a.example/feed.json' })).text).toContain(
      'jsonfeed.org',
    );
    const gone = createNativeTransport({
      request: async () => ({ status: 404, data: 'x', headers: {}, url: '' }),
    });
    expect(await errorCode(gone.fetch({ url: 'https://a.example/x' }))).toBe('http');
  });

  it('classifies bridge failures as timeout, network or offline', async () => {
    const make = (message: string, online: boolean) =>
      createNativeTransport(
        {
          request: async () => {
            throw new Error(message);
          },
        },
        () => online,
      );
    expect(
      await errorCode(make('Read timed out', true).fetch({ url: 'https://a.example/x' })),
    ).toBe('timeout');
    expect(
      await errorCode(make('Unable to resolve host', true).fetch({ url: 'https://a.example/x' })),
    ).toBe('network');
    expect(
      await errorCode(make('Unable to resolve host', false).fetch({ url: 'https://a.example/x' })),
    ).toBe('offline');
  });

  it('refuses a redirect loop and an oversized body', async () => {
    const loop = createNativeTransport({
      request: async () => ({
        status: 302,
        data: '',
        headers: { location: 'https://a.example/again' },
        url: '',
      }),
    });
    expect(await errorCode(loop.fetch({ url: 'https://a.example/x' }))).toBe('network');
    const big = createNativeTransport({
      request: async () => ({ status: 200, data: base64('x'.repeat(2000)), headers: {}, url: '' }),
    });
    expect(await errorCode(big.fetch({ url: 'https://a.example/x', maxBytes: 1000 }))).toBe(
      'too-large',
    );
  });
});
