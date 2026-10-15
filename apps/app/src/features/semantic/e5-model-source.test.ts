import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ name: 'web' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform.name },
}));
const downloaded = vi.hoisted(() => ({ installed: false }));
vi.mock('./e5-model-cache', () => ({
  isDownloadedE5ModelInstalled: async () => downloaded.installed,
}));

import { e5BundledManifest } from './e5-model';
import {
  detectE5ModelSource,
  isE5ModelInstalled,
  platformBundlesQueryModel,
  resetE5ModelSource,
  resolveE5ModelSource,
  WORKER_CONTEXT,
} from './e5-model-source';

const BASE = 'https://localhost/models/kd1-query-encoder/';

function manifestFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe('platform switch of the query model', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    resetE5ModelSource();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    platform.name = 'web';
    downloaded.installed = false;
    resetE5ModelSource();
  });

  it('bundles the model on Android only', () => {
    expect(platformBundlesQueryModel('android')).toBe(true);
    expect(platformBundlesQueryModel('ios')).toBe(false);
    expect(platformBundlesQueryModel('web')).toBe(false);
    // A worker cannot ask Capacitor, so the manifest decides there.
    expect(platformBundlesQueryModel(WORKER_CONTEXT)).toBe(true);
  });

  it('probes from a worker, where the Capacitor platform is unknown, and falls back on the web', async () => {
    vi.unstubAllGlobals();
    platform.name = 'web';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(e5BundledManifest()))),
    );
    expect(await resolveE5ModelSource()).toMatchObject({ kind: 'bundled' });

    resetE5ModelSource();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html></html>', { status: 200 })),
    );
    expect(await resolveE5ModelSource()).toEqual({ kind: 'download' });
  });

  it('keeps the download on the web without touching the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      detectE5ModelSource({ platform: 'web', bundledBaseUrl: BASE, fetchImpl }),
    ).resolves.toEqual({ kind: 'download' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the bundled copy on Android when its manifest matches the pinned files', async () => {
    const fetchImpl = manifestFetch(e5BundledManifest());
    await expect(
      detectE5ModelSource({ platform: 'android', bundledBaseUrl: BASE, fetchImpl }),
    ).resolves.toEqual({ kind: 'bundled', baseUrl: BASE });
    expect(fetchImpl).toHaveBeenCalledWith(new URL('manifest.json', BASE));
  });

  it('falls back to the download when a native build was synced without the model', async () => {
    const stale = { ...e5BundledManifest(), revision: 'kd1-query-encoder-older' };
    for (const fetchImpl of [
      manifestFetch({}, 404),
      manifestFetch(stale),
      vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    ]) {
      await expect(
        detectE5ModelSource({ platform: 'android', bundledBaseUrl: BASE, fetchImpl }),
      ).resolves.toEqual({ kind: 'download' });
    }
  });

  it('rejects a manifest whose checksum differs from the pinned one', async () => {
    const tampered = e5BundledManifest();
    const files = tampered.files.map((file, index) =>
      index === 0 ? { ...file, sha256: '0'.repeat(64) } : file,
    );
    await expect(
      detectE5ModelSource({
        platform: 'android',
        bundledBaseUrl: BASE,
        fetchImpl: manifestFetch({ ...tampered, files }),
      }),
    ).resolves.toEqual({ kind: 'download' });
  });

  it('reports the model as installed on a bundling build and reads the cache elsewhere', async () => {
    platform.name = 'android';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(e5BundledManifest()))),
    );
    const resolved = await resolveE5ModelSource();
    expect(resolved).toMatchObject({ kind: 'bundled' });
    // Resolved from the module's own chunk (<app>/assets/), so a worker gets the same directory.
    expect(
      resolved.kind === 'bundled' && resolved.baseUrl.endsWith('/models/kd1-query-encoder/'),
    ).toBe(true);
    // Nothing is stored on the device, yet meaning search is ready.
    downloaded.installed = false;
    expect(await isE5ModelInstalled()).toBe(true);

    resetE5ModelSource();
    platform.name = 'web';
    expect(await isE5ModelInstalled()).toBe(false);
    downloaded.installed = true;
    expect(await isE5ModelInstalled()).toBe(true);
  });
});
