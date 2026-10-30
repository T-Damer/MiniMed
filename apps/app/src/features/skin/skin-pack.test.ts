import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SKIN_CLASSES } from '@/features/skin/skin-model';
import {
  groupSkinPhotos,
  installSkinPackArchive,
  isSkinPackPublished,
  readInstalledSkinManifest,
  readInstalledSkinPhotos,
  readSkinPackDescriptor,
  readSkinPackResponse,
  removeSkinPack,
  SKIN_PACK_CATALOG,
  SKIN_PACK_TEST_CATALOG_PROPERTY,
  type SkinPackCatalogItem,
  skinPackOffer,
  subscribeSkinPack,
  validateSkinPackArchive,
  verifySkinPackDownload,
} from '@/features/skin/skin-pack';
import {
  buildSkinPackZip,
  type FixturePackOptions,
  fixturePhotos,
} from '@/features/skin/skin-pack-fixture';

const classIds = SKIN_CLASSES.map((entry) => entry.id);
const [melanoma, eczema] = ['melanoma', 'eczema'];
if (!melanoma || !eczema) throw new Error('fixture classes');

function fixture(extra: Partial<FixturePackOptions> = {}): Promise<Uint8Array> {
  return buildSkinPackZip({ classIds, photoClasses: [melanoma, eczema], perClass: 2, ...extra });
}

const buffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

/** In-memory stand-ins for the browser storage the installer writes to. */
function stubBrowser(): { readonly stores: Map<string, Map<string, Response>> } {
  const storage = new Map<string, string>();
  const stores = new Map<string, Map<string, Response>>();
  const target = new EventTarget();
  vi.stubGlobal('window', {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      const entries = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, entries);
      return {
        put: async (url: string, response: Response) => {
          entries.set(url, response);
        },
        match: async (url: string) => entries.get(url)?.clone(),
      };
    },
    delete: async (name: string) => stores.delete(name),
  });
  return { stores };
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: () => undefined }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('skin pack catalog', () => {
  it('offers a download only for a published release', () => {
    const published: SkinPackCatalogItem = {
      id: 'fixture',
      name: 'Fixture',
      description: '',
      version: '1',
      bundleUrl: 'https://example.test/pack.zip',
      bundleSha256: 'a'.repeat(64),
      downloadBytes: 10,
    };
    expect(isSkinPackPublished(published)).toBe(true);
    expect(isSkinPackPublished({ ...published, bundleUrl: '' })).toBe(false);
    expect(isSkinPackPublished({ ...published, bundleSha256: '' })).toBe(false);
    expect(isSkinPackPublished({ ...published, bundleSha256: '0'.repeat(64) })).toBe(false);
    expect(isSkinPackPublished({ ...published, downloadBytes: 0 })).toBe(false);
  });

  it('follows the catalog, and a spec can replace it through the test seam', () => {
    stubBrowser();
    expect(skinPackOffer()).toEqual(SKIN_PACK_CATALOG.find(isSkinPackPublished));
    const injected = {
      id: 'spec',
      name: 'Spec',
      description: '',
      version: '1',
      bundleUrl: 'https://example.test/spec.zip',
      bundleSha256: 'b'.repeat(64),
      downloadBytes: 5,
    };
    (window as unknown as Record<string, unknown>)[SKIN_PACK_TEST_CATALOG_PROPERTY] = injected;
    expect(skinPackOffer()).toEqual(injected);
    (window as unknown as Record<string, unknown>)[SKIN_PACK_TEST_CATALOG_PROPERTY] = {
      ...injected,
      bundleSha256: 'short',
    };
    expect(skinPackOffer()).toEqual(SKIN_PACK_CATALOG.find(isSkinPackPublished));
  });
});

describe('skin pack validation', () => {
  it('accepts a pack and groups its photos by condition', async () => {
    const pack = await validateSkinPackArchive(buffer(await fixture()));
    expect(pack.info.version).toBe('2026.10.30');
    expect(pack.manifest.classes).toEqual(classIds);
    expect(pack.photos).toHaveLength(4);
    const index = groupSkinPhotos(pack.photos);
    expect(index.get(melanoma)).toHaveLength(2);
    expect(index.get(eczema)?.[0]?.source).toBe('SCIN (Google)');
    expect(index.get('nevus')).toBeUndefined();
  });

  it('rejects photo paths that are not photos/<hex>.avif', async () => {
    for (const file of [
      'photos/../x.avif',
      'photos/ABCDEF123456.avif',
      'photos/abcdef123456.png',
      'other/abcdef123456.avif',
      '/photos/abcdef123456.avif',
      'photos/sub/abcdef123456.avif',
    ]) {
      const photos = fixturePhotos([melanoma], 1).map((photo) => ({ ...photo, file }));
      await expect(
        validateSkinPackArchive(buffer(await fixture({ photos, entries: { [file]: null } }))),
      ).rejects.toThrow();
    }
  });

  it('rejects an unknown condition, absurd sizes and an unsafe link', async () => {
    const [photo] = fixturePhotos([melanoma], 1);
    if (!photo) throw new Error('fixture photo');
    for (const bad of [
      { ...photo, class: 'not_a_condition' },
      { ...photo, width: 100_000 },
      { ...photo, height: 3 },
      { ...photo, url: 'javascript:alert(1)' },
      { ...photo, url: 'http://example.test/photo' },
      { ...photo, licence: '' },
    ]) {
      await expect(
        validateSkinPackArchive(buffer(await fixture({ photos: [bad] }))),
      ).rejects.toThrow('Список фотографий');
    }
  });

  it('rejects a missing photo, a non-AVIF file and a duplicated entry', async () => {
    const [photo] = fixturePhotos([melanoma], 1);
    if (!photo) throw new Error('fixture photo');
    await expect(
      validateSkinPackArchive(
        buffer(await fixture({ photos: [photo], entries: { [photo.file]: null } })),
      ),
    ).rejects.toThrow('отсутствует');
    await expect(
      validateSkinPackArchive(
        buffer(await fixture({ photos: [photo], photoBytes: new Uint8Array(40).fill(7) })),
      ),
    ).rejects.toThrow('AVIF');
    await expect(
      validateSkinPackArchive(buffer(await fixture({ photos: [photo, photo] }))),
    ).rejects.toThrow('дважды');
  });

  it('rejects a model of other classes, a missing graph and a foreign format', async () => {
    await expect(
      validateSkinPackArchive(
        buffer(await fixture({ manifest: { classes: [...classIds].reverse() } })),
      ),
    ).rejects.toThrow('не подходит');
    await expect(
      validateSkinPackArchive(buffer(await fixture({ entries: { 'model.onnx': null } }))),
    ).rejects.toThrow('model.onnx');
    await expect(
      validateSkinPackArchive(buffer(await fixture({ info: { format: 'other' } }))),
    ).rejects.toThrow('формат');
    await expect(
      validateSkinPackArchive(buffer(await fixture({ entries: { 'skin-pack.json': null } }))),
    ).rejects.toThrow('skin-pack.json');
  });

  it('rejects an archive with a path that escapes its root', async () => {
    await expect(
      validateSkinPackArchive(buffer(await fixture({ entries: { '../evil.txt': 'x' } }))),
    ).rejects.toThrow('небезопасный путь');
  });
});

describe('skin pack installation', () => {
  it('verifies the download against the catalog before it is used', async () => {
    const bytes = new TextEncoder().encode('abc');
    const item: SkinPackCatalogItem = {
      id: 'fixture',
      name: 'Fixture',
      description: '',
      version: '1',
      bundleUrl: 'https://example.test/pack.zip',
      bundleSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      downloadBytes: 3,
    };
    await expect(verifySkinPackDownload(item, bytes)).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(verifySkinPackDownload(item, new TextEncoder().encode('abd'))).rejects.toThrow(
      'Контрольная сумма',
    );
    await expect(verifySkinPackDownload(item, new TextEncoder().encode('ab'))).rejects.toThrow(
      'Размер',
    );
  });

  it('writes the files, switches the descriptor in and serves them back', async () => {
    const { stores } = stubBrowser();
    const changes = vi.fn();
    const stop = subscribeSkinPack(changes);
    expect(readSkinPackDescriptor()).toBeNull();
    expect(await readInstalledSkinManifest()).toBeUndefined();

    const descriptor = await installSkinPackArchive(buffer(await fixture()));
    expect(changes).toHaveBeenCalledTimes(1);
    expect(readSkinPackDescriptor()).toEqual(descriptor);
    expect(descriptor.photoCount).toBe(4);
    expect(stores.get(descriptor.cacheName)?.size).toBe(8);

    const manifest = await readInstalledSkinManifest();
    expect(manifest?.classes).toEqual(classIds);
    const photos = await readInstalledSkinPhotos();
    expect(photos.get(melanoma)).toHaveLength(2);
    const first = photos.get(melanoma)?.[0];
    const photoResponse = await readSkinPackResponse(first?.file ?? '');
    expect(photoResponse?.headers.get('Content-Type')).toBe('image/avif');
    expect((await photoResponse?.arrayBuffer())?.byteLength).toBe(335);
    const graph = await readSkinPackResponse('model.onnx');
    expect((await graph?.arrayBuffer())?.byteLength).toBeGreaterThan(0);
    stop();
  });

  it('keeps the installed pack when a new one is invalid, and replaces it when valid', async () => {
    const { stores } = stubBrowser();
    const first = await installSkinPackArchive(buffer(await fixture({ version: '1' })));
    await expect(
      installSkinPackArchive(buffer(await fixture({ info: { format: 'other' } }))),
    ).rejects.toThrow();
    expect(readSkinPackDescriptor()).toEqual(first);
    expect(stores.size).toBe(1);

    const second = await installSkinPackArchive(
      buffer(await fixture({ version: '2', photoClasses: [melanoma] })),
    );
    expect(readSkinPackDescriptor()?.version).toBe('2');
    expect(stores.has(first.cacheName)).toBe(false);
    expect(stores.has(second.cacheName)).toBe(true);
    expect((await readInstalledSkinPhotos()).get(eczema)).toBeUndefined();
  });

  it('removes the files and the descriptor', async () => {
    const { stores } = stubBrowser();
    await installSkinPackArchive(buffer(await fixture()));
    await removeSkinPack();
    expect(readSkinPackDescriptor()).toBeNull();
    expect(stores.size).toBe(0);
    expect((await readInstalledSkinPhotos()).size).toBe(0);
    expect(await readSkinPackResponse('model.onnx')).toBeUndefined();
  });
});
