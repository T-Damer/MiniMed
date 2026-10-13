/**
 * The Pages deploy replaces the whole site, so a browser that still runs the previous build asks
 * for chunks that no longer exist. The deploy therefore copies the previous build's scripts and
 * styles that this build dropped into `assets/` once more. Only ONE earlier build is carried: the
 * manifest read from the live site lists that build's own files, never the files it had carried.
 */

import type { ServiceWorkerBuild } from './service-worker-precache';

/** Scripts, styles and fonts only: wasm and data are not worth the space. */
const CARRIED_FILE = /^assets\/[\w.~@-]+\.(?:js|mjs|css|woff2)$/u;
/** The module catalog chunk is the largest script of the app (about 11 MB). */
export const CARRIED_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const CARRIED_MAX_TOTAL_BYTES = 120 * 1024 * 1024;

export function parsePreviousBuildManifest(
  raw: unknown,
): Pick<ServiceWorkerBuild, 'precache'> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const precache = (raw as { precache?: unknown }).precache;
  if (!Array.isArray(precache) || !precache.every((path) => typeof path === 'string')) return null;
  return { precache };
}

/** Files of the previous build that the new build no longer has, safe to download and write. */
export function selectCarriedAssets(
  previous: Pick<ServiceWorkerBuild, 'precache'>,
  existsInNewBuild: (path: string) => boolean,
): string[] {
  return previous.precache.filter(
    (path) => CARRIED_FILE.test(path) && !path.split('/').includes('..') && !existsInNewBuild(path),
  );
}

export interface CarryResult {
  readonly carried: readonly string[];
  readonly skipped: readonly string[];
  readonly bytes: number;
}

/**
 * Downloads the selected files through `download`, within the per-file and total byte caps. A file
 * that cannot be fetched is skipped: the deploy must never fail over a courtesy copy.
 */
export async function carryAssets(
  paths: readonly string[],
  download: (path: string) => Promise<Uint8Array | null>,
  write: (path: string, bytes: Uint8Array) => Promise<void>,
  concurrency = 6,
): Promise<CarryResult> {
  const carried: string[] = [];
  const skipped: string[] = [];
  let bytes = 0;
  const queue = [...paths];
  const run = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      let body: Uint8Array | null = null;
      try {
        body = await download(path);
      } catch (cause) {
        console.warn(`Not carried (${path}):`, cause);
      }
      if (
        !body ||
        body.byteLength > CARRIED_MAX_FILE_BYTES ||
        bytes + body.byteLength > CARRIED_MAX_TOTAL_BYTES
      ) {
        skipped.push(path);
        continue;
      }
      bytes += body.byteLength;
      await write(path, body);
      carried.push(path);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, run));
  return { carried: carried.sort(), skipped: skipped.sort(), bytes };
}
