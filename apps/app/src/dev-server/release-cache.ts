import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, resolve, sep } from 'node:path';

/**
 * Dev/preview-server helper (imported only by vite.config.ts, never by the app bundle): keeps
 * MiniMed release assets in a gitignored disk cache so large models download once.
 */

const RELEASE_ORIGIN = 'https://github.com/T-Damer/MiniMed/releases/download/';
const ALLOWED_REDIRECT_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const MAX_REDIRECTS = 5;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const RELEASE_PATH = /^\/content\/releases\/([^/]+)\/([^/]+)$/u;

export interface ReleaseCacheTarget {
  readonly tag: string;
  readonly fileName: string;
  readonly path: string;
}

function safeSegment(value: string): boolean {
  return SEGMENT.test(value) && !value.includes('..');
}

/** Maps `/content/releases/<tag>/<file>` into the cache root, rejecting anything that escapes it. */
export function resolveReleaseCacheTarget(
  cacheRoot: string,
  requestPath: string,
): ReleaseCacheTarget | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0] ?? '');
  } catch {
    return undefined;
  }
  const match = RELEASE_PATH.exec(decoded);
  const tag = match?.[1];
  const fileName = match?.[2];
  if (!tag || !fileName || !safeSegment(tag) || !safeSegment(fileName)) return undefined;
  const root = resolve(cacheRoot);
  const path = resolve(root, tag, fileName);
  if (!path.startsWith(`${root}${sep}`)) return undefined;
  return { tag, fileName, path };
}

export function isAllowedReleaseUrl(url: URL): boolean {
  return url.protocol === 'https:' && ALLOWED_REDIRECT_HOSTS.has(url.hostname);
}

function fetchToFile(url: URL, destination: string, redirects: number): Promise<void> {
  if (!isAllowedReleaseUrl(url))
    return Promise.reject(new Error(`Release redirect to ${url.hostname} is not allowed.`));
  return new Promise((resolveDownload, reject) => {
    const request = get(url, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        const location = response.headers.location;
        if (!location || redirects >= MAX_REDIRECTS) {
          reject(new Error(`Release download redirect failed (HTTP ${status}).`));
          return;
        }
        fetchToFile(new URL(location, url), destination, redirects + 1).then(
          resolveDownload,
          reject,
        );
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Release download failed (HTTP ${status}).`));
        return;
      }
      const expected = Number(response.headers['content-length']);
      const file = createWriteStream(destination);
      response.pipe(file);
      response.on('error', reject);
      file.on('error', reject);
      file.on('finish', () =>
        file.close(() => {
          const size = statSync(destination).size;
          if (Number.isFinite(expected) && expected > 0 && size !== expected)
            reject(new Error(`Release download truncated: ${size} of ${expected} bytes.`));
          else resolveDownload();
        }),
      );
    });
    request.on('error', reject);
  });
}

/** Downloads to a temporary file and renames it atomically, so an interrupted run leaves no cache. */
export async function downloadReleaseAsset(target: ReleaseCacheTarget): Promise<void> {
  const partial = `${target.path}.${process.pid}.partial`;
  mkdirSync(dirname(target.path), { recursive: true });
  try {
    await fetchToFile(
      new URL(
        `${encodeURIComponent(target.tag)}/${encodeURIComponent(target.fileName)}`,
        RELEASE_ORIGIN,
      ),
      partial,
      0,
    );
    renameSync(partial, target.path);
  } finally {
    rmSync(partial, { force: true });
  }
}
