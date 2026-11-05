/**
 * Polite, cached HTTP for the compound-facts build: one request at a time, a descriptive
 * User-Agent, exponential backoff on 429/5xx, and every raw response kept under
 * `data/raw/compounds/cache/` (gitignored) keyed by a hash of method, URL and body. A rerun with
 * the cache present makes no network call, so the build is deterministic and offline-repeatable.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
export const CACHE_DIR = join(ROOT, 'data/raw/compounds/cache');
const USER_AGENT =
  'MiniMedCompoundFacts/1.0 (offline medical reference; contact dpancov64@gmail.com)';
const MIN_GAP_MS = 1500;

let lastRequestAt = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CachedRequest {
  readonly url: string;
  readonly body?: string;
  readonly accept: string;
  readonly contentType?: string;
}

function cachePath(request: CachedRequest): string {
  const digest = createHash('sha256')
    .update(`${request.url}\n${request.body ?? ''}`)
    .digest('hex')
    .slice(0, 40);
  return join(CACHE_DIR, `${digest}.json`);
}

/** Returns the response text; `fromCache` tells the caller whether the network was used. */
export async function cachedFetch(request: CachedRequest): Promise<string> {
  const path = cachePath(request);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  mkdirSync(CACHE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const response = await fetch(request.url, {
      method: request.body === undefined ? 'GET' : 'POST',
      ...(request.body === undefined ? {} : { body: request.body }),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: request.accept,
        ...(request.contentType ? { 'Content-Type': request.contentType } : {}),
      },
      signal: AbortSignal.timeout(90_000),
    }).catch((error: unknown) => error as Error);
    if (response instanceof Error) {
      await sleep(2 ** attempt * 2000);
      continue;
    }
    if (response.ok) {
      const text = await response.text();
      writeFileSync(path, text);
      return text;
    }
    if (response.status === 404) {
      writeFileSync(path, '');
      return '';
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(
        Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 2 ** attempt * 3000),
      );
      continue;
    }
    throw new Error(`${request.url}: HTTP ${response.status}`);
  }
  throw new Error(`${request.url}: gave up after repeated failures`);
}
