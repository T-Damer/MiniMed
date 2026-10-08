import { Capacitor, CapacitorHttp } from '@capacitor/core';

import type { FetchFailureCode } from '@/features/news/news-types';

/**
 * The only door through which the news feature reaches the network (ADR-0024). One request per
 * call, to the address the user subscribed to, with no cookies, no referrer and nothing but the
 * conditional-request headers. Android uses the native HTTP client (no CORS); the browser uses
 * `fetch` and says honestly when the source does not allow reading it from a page.
 */
export interface FeedRequest {
  readonly url: string;
  readonly method?: 'GET' | 'HEAD';
  readonly etag?: string | undefined;
  readonly lastModified?: string | undefined;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** `Accept` header; feeds by default. A web page or an image asks for its own type. */
  readonly accept?: string;
  /** Return the raw body in `bytes` (icons) instead of decoding it as text. */
  readonly binary?: boolean;
  readonly signal?: AbortSignal | undefined;
}

export interface FeedResponse {
  readonly status: number;
  /** 304: the stored copy is current; `text` is empty. */
  readonly notModified: boolean;
  readonly text: string;
  /** The undecoded body, only for a `binary` request. */
  readonly bytes?: Uint8Array;
  readonly finalUrl: string;
  /** Lower-case header names. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface FeedTransport {
  readonly kind: 'web' | 'native';
  /** Whether ETag / Last-Modified validators can be sent and read back. */
  readonly conditional: boolean;
  fetch(request: FeedRequest): Promise<FeedResponse>;
}

export class FeedFetchError extends Error {
  readonly code: FetchFailureCode;
  readonly status: number | undefined;

  constructor(code: FetchFailureCode, message: string, status?: number) {
    super(message);
    this.name = 'FeedFetchError';
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 6_000_000;

export const FAILURE_MESSAGES: Readonly<Record<FetchFailureCode, string>> = {
  offline: 'Нет сети. Показаны сохранённые записи.',
  cors: 'Этот источник не разрешает чтение из браузера — откройте в приложении для Android или как сайт.',
  network: 'Не удалось связаться с источником.',
  timeout: 'Источник не ответил вовремя.',
  http: 'Источник вернул ошибку.',
  'too-large': 'Ответ источника слишком большой.',
  'not-a-feed': 'По этому адресу нет ленты новостей.',
  malformed: 'Лента повреждена и не читается.',
  empty: 'Источник вернул пустой ответ.',
};

export function failureMessage(code: FetchFailureCode, status?: number): string {
  return code === 'http' && status ? `Источник вернул ошибку ${status}.` : FAILURE_MESSAGES[code];
}

function charsetOf(contentType: string | undefined, bytes: Uint8Array): string {
  const header = /charset\s*=\s*"?([\w.:-]+)/iu.exec(contentType ?? '');
  if (header?.[1]) return header[1];
  let prolog = '';
  for (let index = 0; index < Math.min(bytes.length, 1500); index += 1) {
    prolog += String.fromCharCode(bytes[index] as number);
  }
  const xml = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/iu.exec(prolog.slice(0, 200));
  if (xml?.[1]) return xml[1];
  // Old Russian sites declare windows-1251 only in the page itself: <meta charset> or http-equiv.
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/iu.exec(prolog);
  return meta?.[1] ?? 'utf-8';
}

/** Feeds in windows-1251 and friends are common: the declared charset decides, UTF-8 is the default. */
export function decodeFeedBytes(bytes: Uint8Array, contentType?: string): string {
  const label = charsetOf(contentType, bytes);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function lowerHeaders(headers: Headers | Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[key.toLowerCase()] = value;
  }
  return out;
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > maxBytes)
      throw new FeedFetchError('too-large', FAILURE_MESSAGES['too-large']);
    return buffer;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FeedFetchError('too-large', FAILURE_MESSAGES['too-large']);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export interface WebTransportDeps {
  readonly fetch: typeof fetch;
  readonly online: () => boolean;
}

/**
 * A browser `fetch` rejects with the same TypeError for «no network» and «CORS refused». A
 * `no-cors` request tells them apart: it succeeds (opaque) when the host is reachable, so a failed
 * readable request after a successful opaque one is the source refusing cross-origin reads.
 */
async function classifyBrowserFailure(
  deps: WebTransportDeps,
  url: string,
  signal: AbortSignal,
): Promise<FetchFailureCode> {
  if (!deps.online()) return 'offline';
  try {
    await deps.fetch(url, {
      mode: 'no-cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    });
    return 'cors';
  } catch {
    return 'network';
  }
}

export function createWebTransport(
  deps: WebTransportDeps = {
    fetch: (...args) => globalThis.fetch(...args),
    online: () => navigator.onLine,
  },
): FeedTransport {
  return {
    kind: 'web',
    conditional: false,
    async fetch(request) {
      const controller = new AbortController();
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const relay = (): void => controller.abort();
      request.signal?.addEventListener('abort', relay);
      try {
        // Validators are not sent from a page: they are not CORS-safelisted headers and would turn
        // a readable feed into a blocked preflight. The browser cache revalidates by itself.
        const response = await deps.fetch(request.url, {
          method: request.method ?? 'GET',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'follow',
          cache: 'no-cache',
          ...(request.accept ? { headers: { Accept: request.accept } } : {}),
          signal: controller.signal,
        });
        const headers = lowerHeaders(response.headers);
        if (response.status >= 400) {
          throw new FeedFetchError(
            'http',
            failureMessage('http', response.status),
            response.status,
          );
        }
        if (request.method === 'HEAD') {
          return {
            status: response.status,
            notModified: false,
            text: '',
            finalUrl: response.url || request.url,
            headers,
          };
        }
        const bytes = await readCapped(response, request.maxBytes ?? DEFAULT_MAX_BYTES);
        return {
          status: response.status,
          notModified: response.status === 304,
          text: request.binary ? '' : decodeFeedBytes(bytes, headers['content-type']),
          ...(request.binary ? { bytes } : {}),
          finalUrl: response.url || request.url,
          headers,
        };
      } catch (error) {
        if (error instanceof FeedFetchError) throw error;
        if (timedOut) throw new FeedFetchError('timeout', FAILURE_MESSAGES.timeout);
        if (request.signal?.aborted) throw error;
        const code = await classifyBrowserFailure(
          deps,
          request.url,
          AbortSignal.timeout(Math.min(timeoutMs, 8000)),
        );
        throw new FeedFetchError(code, FAILURE_MESSAGES[code]);
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', relay);
      }
    },
  };
}

export interface NativeHttpResult {
  readonly status: number;
  readonly data: unknown;
  readonly headers: Record<string, string>;
  readonly url: string;
}

export interface NativeHttp {
  request(options: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly responseType: 'arraybuffer';
    readonly connectTimeout: number;
    readonly readTimeout: number;
    readonly disableRedirects: boolean;
  }): Promise<NativeHttpResult>;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/gu, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const MAX_REDIRECTS = 5;

/**
 * The Android client (`CapacitorHttp`, part of @capacitor/core): no CORS, validators allowed, and
 * redirects followed here so an http→https hop (which `HttpURLConnection` refuses) still works.
 * A response with a JSON content type arrives already parsed from the bridge and is re-serialized.
 */
export function createNativeTransport(
  http: NativeHttp = CapacitorHttp as unknown as NativeHttp,
  online: () => boolean = () => navigator.onLine,
): FeedTransport {
  return {
    kind: 'native',
    conditional: true,
    async fetch(request) {
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const headers: Record<string, string> = {
        Accept:
          request.accept ??
          'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
      };
      if (request.etag) headers['If-None-Match'] = request.etag;
      if (request.lastModified) headers['If-Modified-Since'] = request.lastModified;
      let url = request.url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        let result: NativeHttpResult;
        try {
          result = await http.request({
            url,
            method: request.method ?? 'GET',
            headers,
            responseType: 'arraybuffer',
            connectTimeout: timeoutMs,
            readTimeout: timeoutMs,
            disableRedirects: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('timeout') || message.includes('timed out')) {
            throw new FeedFetchError('timeout', FAILURE_MESSAGES.timeout);
          }
          const code: FetchFailureCode = online() ? 'network' : 'offline';
          throw new FeedFetchError(code, FAILURE_MESSAGES[code]);
        }
        const responseHeaders = lowerHeaders(result.headers ?? {});
        if ([301, 302, 303, 307, 308].includes(result.status) && responseHeaders['location']) {
          let next: URL;
          try {
            next = new URL(responseHeaders['location'], url);
          } catch {
            throw new FeedFetchError('network', FAILURE_MESSAGES.network);
          }
          if (next.protocol !== 'https:' && next.protocol !== 'http:') {
            throw new FeedFetchError('network', FAILURE_MESSAGES.network);
          }
          url = next.href;
          continue;
        }
        if (result.status >= 400) {
          throw new FeedFetchError('http', failureMessage('http', result.status), result.status);
        }
        if (result.status === 304) {
          return {
            status: 304,
            notModified: true,
            text: '',
            finalUrl: url,
            headers: responseHeaders,
          };
        }
        if (request.method === 'HEAD') {
          return {
            status: result.status,
            notModified: false,
            text: '',
            finalUrl: url,
            headers: responseHeaders,
          };
        }
        const data = result.data;
        let bytes: Uint8Array;
        if (typeof data === 'string') {
          try {
            bytes = base64ToBytes(data);
          } catch {
            bytes = new TextEncoder().encode(data);
          }
        } else if (data !== null && data !== undefined) {
          bytes = new TextEncoder().encode(JSON.stringify(data));
        } else {
          bytes = new Uint8Array(0);
        }
        if (bytes.length > (request.maxBytes ?? DEFAULT_MAX_BYTES)) {
          throw new FeedFetchError('too-large', FAILURE_MESSAGES['too-large']);
        }
        return {
          status: result.status,
          notModified: false,
          text: request.binary ? '' : decodeFeedBytes(bytes, responseHeaders['content-type']),
          ...(request.binary ? { bytes } : {}),
          finalUrl: url,
          headers: responseHeaders,
        };
      }
      throw new FeedFetchError('network', FAILURE_MESSAGES.network);
    },
  };
}

export function createDefaultFeedTransport(): FeedTransport {
  return Capacitor.isNativePlatform() ? createNativeTransport() : createWebTransport();
}
