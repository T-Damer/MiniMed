/**
 * The skin pack: one downloadable ZIP with the «Кожа по фото» model and the reference photos of the
 * atlas (built by tools/derm-cnn/build_skin_pack.py, published as a GitHub release asset like the
 * ECG packs). Installation mirrors the ECG digitizer: the download is verified against the catalog
 * (size and SHA-256), every file inside is validated, and only then are the files written to a Cache
 * Storage cache and a descriptor switched in atomically. Without a pack the tool falls back to the
 * developer's `public/models/skin/` files (skin-model-client.ts) and to the drawn atlas art.
 */
import { z } from 'zod';

import { resolveEcgModelDownloadUrl } from '@/features/calculators/ecg-model';
import type { DownloadContext } from '@/features/downloads/download-queue';
import { downloadWithRetry } from '@/features/network/download-retry';
import { SKIN_CLASSES } from '@/features/skin/skin-model';
import {
  parseSkinModelManifest,
  type SkinModelManifest,
} from '@/features/skin/skin-model-manifest';
import {
  SKIN_PACK_DOWNLOAD_BYTES,
  SKIN_PACK_RELEASE_URL,
  SKIN_PACK_SHA256,
  SKIN_PACK_VERSION,
} from '@/features/skin/skin-pack-catalog';
import { createZipReader } from '@/state/user-library-zip';

export const SKIN_PACK_FORMAT = 'minimed-skin-pack';
export const SKIN_PACK_FORMAT_VERSION = 1;
export const SKIN_PACK_INFO_FILE = 'skin-pack.json';
export const SKIN_PACK_STORAGE_ORIGIN = 'https://minimed.local/skin-pack/';
/** The cache entry that holds the validated model manifest, whatever the ZIP called it. */
export const SKIN_PACK_MANIFEST_ENTRY = 'skin-model.json';
export const SKIN_PACK_PHOTOS_ENTRY = 'photos.json';

const STORAGE_KEY = 'minimed.skin-pack';
const CHANGE_EVENT = 'minimed:skin-pack-change';
const CACHE_PREFIX = 'minimed-skin-pack-';
/** A reference photo is ~35 KB; anything beyond this is not one. */
const MAX_PHOTO_BYTES = 1024 * 1024;
const MAX_PHOTOS = 1000;
const MAX_MODEL_FILE_BYTES = 128 * 1024 * 1024;

export interface SkinPackCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly bundleUrl: string;
  readonly bundleSha256: string;
  readonly downloadBytes: number;
}

export const SKIN_PACK_CATALOG: readonly SkinPackCatalogItem[] = [
  {
    id: 'skin-pack',
    name: 'Кожа по фото',
    description: 'Модель сходства снимка с состояниями кожи и справочные фотографии для атласа.',
    version: SKIN_PACK_VERSION,
    bundleUrl: SKIN_PACK_RELEASE_URL,
    bundleSha256: SKIN_PACK_SHA256,
    downloadBytes: SKIN_PACK_DOWNLOAD_BYTES,
  },
];

/** A catalog entry whose release has been published: a real URL, checksum and size. */
export function isSkinPackPublished(item: SkinPackCatalogItem): boolean {
  return (
    item.bundleUrl.startsWith('https://') &&
    /^[0-9a-f]{64}$/u.test(item.bundleSha256) &&
    !/^0+$/u.test(item.bundleSha256) &&
    Number.isSafeInteger(item.downloadBytes) &&
    item.downloadBytes > 0
  );
}

/**
 * A test-only seam, like `__minimedSkinTestModel`: a browser spec cannot know the checksum of the
 * pack it serves, so it puts a catalog entry of its own on `window` before the page starts. Nothing
 * in the product sets this property.
 */
export const SKIN_PACK_TEST_CATALOG_PROPERTY = '__minimedSkinPackCatalog';

const CatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  version: z.string().min(1),
  bundleUrl: z.string().min(1),
  bundleSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  downloadBytes: z.number().int().positive(),
});

/** The pack this build can download, or undefined while none is published. */
export function skinPackOffer(): SkinPackCatalogItem | undefined {
  if (typeof window !== 'undefined') {
    const injected = CatalogItemSchema.safeParse(
      (window as unknown as Record<string, unknown>)[SKIN_PACK_TEST_CATALOG_PROPERTY],
    );
    if (injected.success) return injected.data;
  }
  return SKIN_PACK_CATALOG.find(isSkinPackPublished);
}

// ---------------------------------------------------------------------------------------------
// The files inside the ZIP, validated at the boundary.

const SkinPackInfoSchema = z.object({
  format: z.literal(SKIN_PACK_FORMAT),
  formatVersion: z.literal(SKIN_PACK_FORMAT_VERSION),
  version: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  model: z.string().regex(/^[\w-]+\.json$/u),
  photos: z.string().regex(/^[\w-]+\.json$/u),
});

const CLASS_IDS: ReadonlySet<string> = new Set(SKIN_CLASSES.map((entry) => entry.id));

const SkinPhotoSchema = z.object({
  class: z.string().refine((id) => CLASS_IDS.has(id), 'unknown skin class'),
  file: z.string().regex(/^photos\/[0-9a-f]{6,64}\.avif$/u),
  width: z.number().int().min(32).max(8192),
  height: z.number().int().min(32).max(8192),
  source: z.string().min(1).max(80),
  author: z.string().max(300),
  licence: z.string().min(1).max(120),
  url: z
    .string()
    .max(600)
    .refine((value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'photo source must be an https link'),
});
export type SkinPhoto = z.infer<typeof SkinPhotoSchema>;

const SkinPhotosFileSchema = z.object({ photos: z.array(SkinPhotoSchema).max(MAX_PHOTOS) });

/** Reference photos by condition id, in the pack's order (the first one is the tile). */
export type SkinPhotoIndex = ReadonlyMap<string, readonly SkinPhoto[]>;

export function groupSkinPhotos(photos: readonly SkinPhoto[]): SkinPhotoIndex {
  const index = new Map<string, SkinPhoto[]>();
  for (const photo of photos) {
    if (!CLASS_IDS.has(photo.class)) continue;
    const list = index.get(photo.class);
    if (list) list.push(photo);
    else index.set(photo.class, [photo]);
  }
  return index;
}

const SkinPackDescriptorSchema = z.object({
  cacheName: z.string().startsWith(CACHE_PREFIX),
  checksum: z.string().regex(/^[0-9a-f]{64}$/u),
  fileBytes: z.number().int().nonnegative(),
  installedAt: z.string(),
  name: z.string(),
  version: z.string(),
  photoCount: z.number().int().nonnegative(),
});
export type SkinPackDescriptor = z.infer<typeof SkinPackDescriptorSchema>;

/** `avif`/`avis` brand in the leading `ftyp` box: the cheapest check that a file is not something else. */
function looksLikeAvif(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const text = (from: number): string => String.fromCharCode(...bytes.subarray(from, from + 4));
  return text(4) === 'ftyp' && (text(8) === 'avif' || text(8) === 'avis');
}

function safeArchivePath(path: string): string {
  const normalized = path.replace(/\\/gu, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Архив содержит небезопасный путь: ${path}.`);
  }
  return normalized;
}

function decodeJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${label}: неверный JSON.`);
  }
}

export interface ValidatedSkinPack {
  readonly info: z.infer<typeof SkinPackInfoSchema>;
  readonly manifest: SkinModelManifest;
  readonly photos: readonly SkinPhoto[];
  /** Everything to store, by its path in the pack. */
  readonly files: ReadonlyMap<string, { readonly bytes: Uint8Array; readonly type: string }>;
}

/** Reads and validates every file of a pack archive; throws a Russian message on the first problem. */
export async function validateSkinPackArchive(data: ArrayBuffer): Promise<ValidatedSkinPack> {
  const reader = createZipReader(data);
  const paths = new Set(reader.paths.map(safeArchivePath));
  const read = async (path: string, limit: number): Promise<Uint8Array> => {
    if (!paths.has(path)) throw new Error(`В архиве отсутствует ${path}.`);
    const bytes = await reader.read(path);
    if (!bytes?.byteLength) throw new Error(`Файл ${path} пуст.`);
    if (bytes.byteLength > limit) throw new Error(`Файл ${path} слишком большой.`);
    return bytes;
  };
  const infoBytes = await read(SKIN_PACK_INFO_FILE, 64 * 1024);
  const infoResult = SkinPackInfoSchema.safeParse(decodeJson(infoBytes, SKIN_PACK_INFO_FILE));
  if (!infoResult.success) throw new Error('Неподдерживаемый формат пакета «Кожа по фото».');
  const info = infoResult.data;
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  files.set(SKIN_PACK_INFO_FILE, { bytes: infoBytes, type: 'application/json' });

  const manifestBytes = await read(info.model, 256 * 1024);
  const manifest = parseSkinModelManifest(new TextDecoder().decode(manifestBytes));
  if (!manifest) throw new Error('Модель в пакете не подходит к этой версии приложения.');
  files.set(SKIN_PACK_MANIFEST_ENTRY, { bytes: manifestBytes, type: 'application/json' });
  for (const model of manifest.models) {
    files.set(model.file, {
      bytes: await read(model.file, MAX_MODEL_FILE_BYTES),
      type: 'application/octet-stream',
    });
  }

  const photosBytes = await read(info.photos, 4 * 1024 * 1024);
  const photosResult = SkinPhotosFileSchema.safeParse(decodeJson(photosBytes, info.photos));
  if (!photosResult.success) throw new Error('Список фотографий в пакете неверен.');
  const photos = photosResult.data.photos;
  files.set(SKIN_PACK_PHOTOS_ENTRY, { bytes: photosBytes, type: 'application/json' });
  const seen = new Set<string>();
  for (const photo of photos) {
    if (seen.has(photo.file)) throw new Error(`Фотография ${photo.file} указана дважды.`);
    seen.add(photo.file);
    const bytes = await read(photo.file, MAX_PHOTO_BYTES);
    if (!looksLikeAvif(bytes)) throw new Error(`Файл ${photo.file} не является изображением AVIF.`);
    files.set(photo.file, { bytes, type: 'image/avif' });
  }
  return { info, manifest, photos, files };
}

// ---------------------------------------------------------------------------------------------
// The installed pack: a Cache Storage cache named by the descriptor.

export function skinPackStorageUrl(path: string): string {
  return `${SKIN_PACK_STORAGE_ORIGIN}${path}`;
}

async function digestHex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readSkinPackDescriptor(): SkinPackDescriptor | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = SkinPackDescriptorSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Object URLs of the photos shown so far; revoked when the pack changes. */
const photoUrls = new Map<string, Promise<string | undefined>>();

function forgetPhotoUrls(): void {
  for (const pending of photoUrls.values()) {
    void pending.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  photoUrls.clear();
}

function writeDescriptor(descriptor: SkinPackDescriptor | null): void {
  if (descriptor) localStorage.setItem(STORAGE_KEY, JSON.stringify(descriptor));
  else localStorage.removeItem(STORAGE_KEY);
  forgetPhotoUrls();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeSkinPack(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) {
      forgetPhotoUrls();
      listener();
    }
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** A file of the installed pack, or undefined when no pack is installed or the file is not in it. */
export async function readSkinPackResponse(path: string): Promise<Response | undefined> {
  const descriptor = readSkinPackDescriptor();
  if (!descriptor || !('caches' in globalThis)) return undefined;
  try {
    const cache = await caches.open(descriptor.cacheName);
    return await cache.match(skinPackStorageUrl(path));
  } catch (cause) {
    console.warn('The skin pack could not be read.', cause instanceof Error ? cause.name : cause);
    return undefined;
  }
}

/** The model manifest of the installed pack (validated again on every read). */
export async function readInstalledSkinManifest(): Promise<SkinModelManifest | undefined> {
  const response = await readSkinPackResponse(SKIN_PACK_MANIFEST_ENTRY);
  return response ? parseSkinModelManifest(await response.text()) : undefined;
}

/** The reference photos of the installed pack, grouped by condition; empty without a pack. */
export async function readInstalledSkinPhotos(): Promise<SkinPhotoIndex> {
  const response = await readSkinPackResponse(SKIN_PACK_PHOTOS_ENTRY);
  if (!response) return new Map();
  const parsed = SkinPhotosFileSchema.safeParse(await response.json());
  return parsed.success ? groupSkinPhotos(parsed.data.photos) : new Map();
}

/** An object URL for one photo of the installed pack; the same URL until the pack changes. */
export function skinPackPhotoUrl(file: string): Promise<string | undefined> {
  const known = photoUrls.get(file);
  if (known) return known;
  const pending = readSkinPackResponse(file).then(async (response) =>
    response ? URL.createObjectURL(await response.blob()) : undefined,
  );
  photoUrls.set(file, pending);
  return pending;
}

function storedCacheName(): string | null {
  return readSkinPackDescriptor()?.cacheName ?? null;
}

export async function installSkinPackArchive(data: ArrayBuffer): Promise<SkinPackDescriptor> {
  if (!('caches' in globalThis)) {
    throw new Error('Браузер не поддерживает локальное хранилище моделей.');
  }
  const pack = await validateSkinPackArchive(data);
  const checksum = await digestHex(data);
  const cacheName = `${CACHE_PREFIX}${checksum.slice(0, 24)}-${Date.now().toString(36)}`;
  const previousCacheName = storedCacheName();
  const cache = await caches.open(cacheName);
  try {
    for (const [path, file] of pack.files) {
      await cache.put(
        skinPackStorageUrl(path),
        new Response(Uint8Array.from(file.bytes), { headers: { 'Content-Type': file.type } }),
      );
    }
  } catch (cause) {
    await caches.delete(cacheName);
    throw cause;
  }
  const descriptor: SkinPackDescriptor = {
    cacheName,
    checksum,
    fileBytes: data.byteLength,
    installedAt: new Date().toISOString(),
    name: pack.info.name,
    version: pack.info.version,
    photoCount: pack.photos.length,
  };
  try {
    writeDescriptor(descriptor);
  } catch (cause) {
    await caches.delete(cacheName);
    throw cause;
  }
  if (previousCacheName && previousCacheName !== cacheName) await caches.delete(previousCacheName);
  return descriptor;
}

export async function verifySkinPackDownload(
  item: SkinPackCatalogItem,
  bytes: Uint8Array,
): Promise<ArrayBuffer> {
  if (bytes.byteLength !== item.downloadBytes) {
    throw new Error('Размер загруженного пакета не совпадает с каталогом.');
  }
  const data = Uint8Array.from(bytes).buffer;
  if ((await digestHex(data)) !== item.bundleSha256) {
    throw new Error('Контрольная сумма загруженного пакета не совпадает с каталогом.');
  }
  return data;
}

/** Same mirror rules as every release model (the web copy next to the app, the Pages mirror in the APK). */
export function resolveSkinPackDownloadUrl(bundleUrl: string, expectedSha256?: string): string {
  return resolveEcgModelDownloadUrl(bundleUrl, expectedSha256);
}

export async function installSkinPackFromCatalog(
  item: SkinPackCatalogItem,
  options: {
    readonly signal?: AbortSignal;
    readonly downloadContext?: DownloadContext;
    readonly onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  } = {},
): Promise<SkinPackDescriptor> {
  const bytes = await downloadWithRetry({
    ...(options.downloadContext ? { jobId: options.downloadContext.id, trackProgress: false } : {}),
    url: resolveSkinPackDownloadUrl(item.bundleUrl, item.bundleSha256),
    cacheKey: `skin-pack:${item.id}:${item.bundleSha256}`,
    expectedBytes: item.downloadBytes,
    ...(options.signal ? { signal: options.signal } : {}),
    retryMissingAssets: false,
    onProgress: ({ downloadedBytes, totalBytes }) =>
      options.onProgress?.(downloadedBytes, totalBytes ?? item.downloadBytes),
  });
  options.signal?.throwIfAborted();
  options.downloadContext?.phase('verifying');
  const verified = await verifySkinPackDownload(item, bytes);
  options.signal?.throwIfAborted();
  options.downloadContext?.phase('installing');
  // Cache activation is atomic; the caller observes its result before honouring a late abort.
  return installSkinPackArchive(verified);
}

export async function removeSkinPack(): Promise<void> {
  const cacheName = storedCacheName();
  writeDescriptor(null);
  if (cacheName) await caches.delete(cacheName);
}
