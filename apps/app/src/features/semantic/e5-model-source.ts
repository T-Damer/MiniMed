import { Capacitor } from '@capacitor/core';

import { E5_BUNDLED_DIR, E5_BUNDLED_MANIFEST, isPinnedE5BundledManifest } from './e5-model';
import { isDownloadedE5ModelInstalled } from './e5-model-cache';

/**
 * Where the meaning-search query model comes from (owner decision 2026-10-15): the Android APK
 * carries it in its web assets (`scripts/fetch-query-model.ts`), every other platform keeps the
 * optional download into IndexedDB. The decision is made once per page at run time through the
 * Capacitor platform check, and a bundled copy counts only when its manifest matches the pinned
 * revision, so a native build that was synced without the model (a developer build) still offers
 * the download instead of silently searching without meaning.
 */
export type E5ModelSource =
  | { readonly kind: 'bundled'; readonly baseUrl: string }
  | { readonly kind: 'download' };

/**
 * What a worker reports instead of a platform: the Capacitor bridge object exists only in the
 * document, so `Capacitor.getPlatform()` answers `web` inside the search worker even on Android.
 */
export const WORKER_CONTEXT = 'worker';

/**
 * Platforms whose build packs the model: Android (iOS keeps the download, see the docs). A worker
 * cannot tell its platform, so the manifest probe decides there; the document, which can, never
 * probes on the web.
 */
export function platformBundlesQueryModel(platform: string): boolean {
  return platform === 'android' || platform === WORKER_CONTEXT;
}

export interface E5ModelSourceDeps {
  readonly platform: string;
  /** Absolute URL of the bundled directory, with a trailing slash. */
  readonly bundledBaseUrl: string;
  readonly fetchImpl: typeof fetch;
}

// The chunk of this module lives in `<app>/assets/`, the bundled model in `<app>/models/`. Resolved
// from the chunk itself so that the document and the search worker (whose own URL is a script under
// assets/) agree. Built from a variable on purpose: Vite must not treat it as an asset import.
const BUNDLED_DIR_FROM_CHUNK = `../${E5_BUNDLED_DIR}/`;

function defaultDeps(): E5ModelSourceDeps {
  return {
    platform: typeof window === 'undefined' ? WORKER_CONTEXT : Capacitor.getPlatform(),
    bundledBaseUrl: new URL(BUNDLED_DIR_FROM_CHUNK, import.meta.url).href,
    fetchImpl: (input, init) => fetch(input, init),
  };
}

export async function detectE5ModelSource(deps: E5ModelSourceDeps): Promise<E5ModelSource> {
  if (!platformBundlesQueryModel(deps.platform)) return { kind: 'download' };
  try {
    const response = await deps.fetchImpl(new URL(E5_BUNDLED_MANIFEST, deps.bundledBaseUrl));
    if (response.ok && isPinnedE5BundledManifest(await response.json())) {
      return { kind: 'bundled', baseUrl: deps.bundledBaseUrl };
    }
  } catch (cause) {
    // A web page probing from a worker finds no manifest; only a native build owes one.
    if (deps.platform === 'android') {
      console.warn('Встроенная модель поиска по смыслу не прочитана.', cause);
    }
    return { kind: 'download' };
  }
  if (deps.platform === 'android') {
    console.warn('В сборке нет встроенной модели поиска по смыслу: доступна загрузка.');
  }
  return { kind: 'download' };
}

let detected: Promise<E5ModelSource> | undefined;

/** The source of this page, decided on first use (a small manifest read on Android, none elsewhere). */
export function resolveE5ModelSource(): Promise<E5ModelSource> {
  detected ??= detectE5ModelSource(defaultDeps());
  return detected;
}

/** Test hook: forget the memoised decision. */
export function resetE5ModelSource(): void {
  detected = undefined;
}

/** True when the model is usable now: bundled in the build or downloaded and verified. */
export async function isE5ModelInstalled(): Promise<boolean> {
  if ((await resolveE5ModelSource()).kind === 'bundled') return true;
  return isDownloadedE5ModelInstalled();
}
