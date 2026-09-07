import type { DownloadContext } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { downloadWithRetry } from '@/features/network/download-retry';

export const REFERENCE_IMAGES_DOWNLOAD_ID = 'images:reference';
const SOURCE_ORIGIN = 'https://www.krasotaimedicina.ru';
const STATIC_ASSET_ROOT = './content/reference-images/';
const IMAGE_MIRROR =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/datasets/content-2026-09-06/';
// Updated by the static reference-image build. A mismatched manifest is never trusted.
export const REFERENCE_IMAGE_MANIFEST_SHA256 =
  'sha256:2c94aa201d6313a621a4e3a361264b035d01935a291b20aace5212936820b42e';
const DOCUMENT_ID = /^krasotaimedicina\.disease\.[a-f0-9]{16}$/u;
const ASSET_PATH = /^assets\/[a-f0-9]{64}\.(?:jpg|jpeg|png|gif|webp|bmp)$/iu;
const CONTENT_TYPE = /^image\/(?:bmp|gif|jpeg|png|webp)$/u;

interface ManifestImageRecord {
  readonly alt: string;
  readonly contentType: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly sourceUrl: string;
}

interface ParsedImageManifest {
  readonly images: ReadonlyMap<string, readonly ManifestImageRecord[]>;
}

export interface ResolvedReferenceImage {
  readonly alt: string;
  readonly contentType: string;
  readonly sourceUrl: string;
  readonly url: string;
}

export interface ReferenceImageResolverOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly manifestSha256?: string;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === SOURCE_ORIGIN &&
      url.pathname.startsWith('/upload/') &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function manifestRecord(value: unknown): ManifestImageRecord | null {
  const record = recordValue(value);
  const alt = stringValue(record?.['alt']);
  const contentType = stringValue(record?.['contentType']);
  const path = stringValue(record?.['path']);
  const sha256 = stringValue(record?.['sha256']);
  const size = record?.['size'];
  const source = stringValue(record?.['sourceUrl']);
  const pathHash = path?.match(/^assets\/([a-f0-9]{64})\./iu)?.[1];
  if (
    !alt ||
    !contentType ||
    !CONTENT_TYPE.test(contentType) ||
    !path ||
    !ASSET_PATH.test(path) ||
    !sha256 ||
    !/^sha256:[a-f0-9]{64}$/u.test(sha256) ||
    sha256.slice('sha256:'.length) !== pathHash ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    !source ||
    sourceUrl(source) === null
  ) {
    return null;
  }
  return { alt, contentType, path, sha256, size, sourceUrl: source };
}

function parseManifest(value: unknown): ParsedImageManifest | null {
  const manifest = recordValue(value);
  if (manifest?.['schemaVersion'] !== 1 || manifest?.['sourceUrl'] !== SOURCE_ORIGIN) return null;
  const images = recordValue(manifest?.['images']);
  if (!images) return null;
  const result = new Map<string, readonly ManifestImageRecord[]>();
  for (const [documentId, valueForDocument] of Object.entries(images)) {
    if (!DOCUMENT_ID.test(documentId) || !Array.isArray(valueForDocument)) continue;
    const records = valueForDocument.flatMap((value) => {
      const record = manifestRecord(value);
      return record ? [record] : [];
    });
    if (records.length > 0) result.set(documentId, records);
  }
  return { images: result };
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return `sha256:${[...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function sameOriginUrl(baseUrl: string, path: string): string | null {
  try {
    const url = new URL(path, baseUrl);
    return typeof window !== 'undefined' && url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

function defaultAssetBaseUrl(): string {
  if (typeof window === 'undefined') return STATIC_ASSET_ROOT;
  return new URL(STATIC_ASSET_ROOT, new URL(import.meta.env.BASE_URL, window.location.href)).href;
}

export class ReferenceImageResolver {
  private readonly fetchValue: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly manifestSha256: string;
  private readonly manifests = new Map<string, Promise<ParsedImageManifest | null>>();
  private readonly images = new Map<string, Promise<ResolvedReferenceImage | null>>();
  private readonly objectUrls = new Set<string>();
  private cacheGeneration = 0;
  private readonly localAssets: boolean;
  private readonly customFetch: boolean;

  private cacheName(): string {
    return `minimed.reference-images:${this.manifestSha256}`;
  }

  private async cache(): Promise<Cache | null> {
    return typeof caches === 'undefined' ? null : caches.open(this.cacheName());
  }

  public constructor(options: ReferenceImageResolverOptions = {}) {
    this.fetchValue = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.customFetch = Boolean(options.fetch);
    this.localAssets = Boolean(options.baseUrl) || import.meta.env.DEV;
    this.baseUrl = options.baseUrl ?? defaultAssetBaseUrl();
    this.manifestSha256 = options.manifestSha256 ?? REFERENCE_IMAGE_MANIFEST_SHA256;
  }

  private async loadManifest(): Promise<ParsedImageManifest | null> {
    const digestValue = encodeURIComponent(this.manifestSha256.slice('sha256:'.length));
    const manifestUrl = sameOriginUrl(this.baseUrl, `manifest.json?sha256=${digestValue}`);
    if (!manifestUrl) return null;
    const response = await this.fetchValue(manifestUrl, { credentials: 'same-origin' });
    if (!response.ok)
      throw new Error(`Не удалось загрузить манифест иллюстраций (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((await digest(bytes)) !== this.manifestSha256) {
      throw new Error('Манифест иллюстраций не прошёл проверку контрольной суммы.');
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('Манифест иллюстраций повреждён.');
    }
    const parsed = parseManifest(manifest);
    if (!parsed) throw new Error('Манифест иллюстраций имеет неподдерживаемый формат.');
    return parsed;
  }

  private manifest(): Promise<ParsedImageManifest | null> {
    const key = this.baseUrl;
    let pending = this.manifests.get(key);
    if (!pending) {
      pending = this.loadManifest().catch((error: unknown) => {
        this.manifests.delete(key);
        throw error;
      });
      this.manifests.set(key, pending);
    }
    return pending;
  }

  private async loadImage(
    documentId: string,
    source: string,
  ): Promise<ResolvedReferenceImage | null> {
    const generation = this.cacheGeneration;
    const parsed = await this.manifest();
    const record = parsed?.images.get(documentId)?.find((image) => image.sourceUrl === source);
    if (!parsed || !record || !record.path.startsWith('assets/')) return null;
    const assetUrl = sameOriginUrl(this.baseUrl, record.path);
    if (!assetUrl) return null;
    const bytes = await this.imageBytes(record);
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    const url = URL.createObjectURL(new Blob([blobBytes.buffer], { type: record.contentType }));
    if (generation !== this.cacheGeneration) {
      URL.revokeObjectURL(url);
      return null;
    }
    this.objectUrls.add(url);
    return { alt: record.alt, contentType: record.contentType, sourceUrl: record.sourceUrl, url };
  }

  private async imageBytes(
    record: ManifestImageRecord,
    signal?: AbortSignal,
    jobId?: string,
  ): Promise<Uint8Array> {
    const assetUrl = sameOriginUrl(this.baseUrl, record.path);
    if (!assetUrl) throw new Error('Некорректный адрес локального изображения.');
    const cache = await this.cache();
    const cached = await cache?.match(assetUrl);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (bytes.byteLength === record.size && (await digest(bytes)) === record.sha256) return bytes;
      await cache?.delete(assetUrl);
    }
    const url = this.localAssets ? assetUrl : new URL(record.path, IMAGE_MIRROR).href;
    const read = async (): Promise<Uint8Array> => {
      const response = await this.fetchValue(url, {
        credentials: 'omit',
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new Error(`Не удалось скачать иллюстрацию (HTTP ${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    };
    const bytes = this.customFetch
      ? await getDownloadQueue().transfer(
          jobId ?? REFERENCE_IMAGES_DOWNLOAD_ID,
          record.sha256,
          signal ?? new AbortController().signal,
          read,
        )
      : await downloadWithRetry({
          url,
          cacheKey: record.sha256,
          expectedBytes: record.size,
          ...(signal ? { signal } : {}),
          ...(jobId ? { jobId, trackProgress: false } : {}),
          retryMissingAssets: false,
        });
    signal?.throwIfAborted();
    if (bytes.byteLength !== record.size || (await digest(bytes)) !== record.sha256) {
      throw new Error('Иллюстрация не прошла проверку контрольной суммы.');
    }
    await cache?.put(
      assetUrl,
      new Response(Uint8Array.from(bytes), { headers: { 'Content-Type': record.contentType } }),
    );
    return bytes;
  }

  public async downloadStatus(): Promise<{
    readonly complete: boolean;
    readonly files: number;
    readonly totalBytes: number;
    readonly totalFiles: number;
  }> {
    const cache = await this.cache();
    const complete = Boolean(await cache?.match(new URL('complete', this.baseUrl).href));
    const files = (await cache?.keys())?.length ?? 0;
    const manifest = await this.manifest();
    const records = new Map(
      [...(manifest?.images.values() ?? [])].flat().map((record) => [record.path, record]),
    );
    const totalBytes = [...records.values()].reduce((sum, record) => sum + record.size, 0);
    return {
      complete,
      files: Math.max(0, files - Number(complete)),
      totalBytes,
      totalFiles: records.size,
    };
  }

  public async downloadAll(
    signal: AbortSignal,
    onProgress: (downloadedBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    return getDownloadQueue().run(
      {
        id: REFERENCE_IMAGES_DOWNLOAD_ID,
        kind: 'images',
        title: 'Иллюстрации справочника',
        resume: {
          kind: 'reference-images',
          id: REFERENCE_IMAGES_DOWNLOAD_ID,
          version: this.manifestSha256,
        },
      },
      (context) => this.downloadBatch(context, onProgress),
      {
        signal,
        retry: () => this.downloadAll(new AbortController().signal, () => undefined),
      },
    );
  }

  private async downloadBatch(
    context: DownloadContext,
    onProgress: (downloadedBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    const { signal } = context;
    const cache = await this.cache();
    if (!cache) throw new Error('Хранилище изображений недоступно.');
    const manifest = await this.manifest();
    if (!manifest) throw new Error('Каталог иллюстраций недоступен.');
    const records = new Map(
      [...manifest.images.values()].flat().map((record) => [record.path, record]),
    );
    const total = [...records.values()].reduce((sum, record) => sum + record.size, 0);
    const pending = records.values();
    let downloaded = 0;
    let completedFiles = 0;
    let failed = false;
    onProgress(0, total);
    context.progress(0, total, 0, records.size);
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, async () => {
        try {
          while (!failed) {
            signal.throwIfAborted();
            const next = pending.next();
            if (next.done) return;
            await this.imageBytes(next.value, signal, context.id);
            downloaded += next.value.size;
            completedFiles += 1;
            context.progress(downloaded, total, completedFiles, records.size);
            onProgress(downloaded, total);
          }
        } catch (cause) {
          failed = true;
          throw cause;
        }
      }),
    );
    const error = results.find((result) => result.status === 'rejected');
    if (error?.status === 'rejected') throw error.reason;
    signal.throwIfAborted();
    context.phase('installing');
    await cache.put(new URL('complete', this.baseUrl).href, new Response(this.manifestSha256));
  }

  public async removeDownloaded(): Promise<void> {
    await getDownloadQueue().cancel(REFERENCE_IMAGES_DOWNLOAD_ID);
    if (typeof caches !== 'undefined') await caches.delete(this.cacheName());
    this.clear();
  }

  public resolve(
    documentIdValue: unknown,
    sourceValue: unknown,
  ): Promise<ResolvedReferenceImage | null> {
    const documentId =
      typeof documentIdValue === 'string' && DOCUMENT_ID.test(documentIdValue)
        ? documentIdValue
        : null;
    const source = typeof sourceValue === 'string' ? sourceUrl(sourceValue) : null;
    if (!documentId || !source) return Promise.resolve(null);
    const key = `${documentId}\u001f${source}`;
    let pending = this.images.get(key);
    if (!pending) {
      pending = this.loadImage(documentId, source).catch((error: unknown) => {
        this.images.delete(key);
        throw error;
      });
      this.images.set(key, pending);
    }
    return pending;
  }

  public async resolveFirst(documentIdValue: unknown): Promise<ResolvedReferenceImage | null> {
    const documentId =
      typeof documentIdValue === 'string' && DOCUMENT_ID.test(documentIdValue)
        ? documentIdValue
        : null;
    if (!documentId) return null;
    const parsed = await this.manifest();
    const source = parsed?.images.get(documentId)?.[0]?.sourceUrl;
    return source ? this.resolve(documentId, source) : null;
  }

  public clear(): void {
    this.cacheGeneration += 1;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.manifests.clear();
    this.images.clear();
  }

  public dispose(): void {
    this.clear();
  }
}

let sharedResolver: ReferenceImageResolver | null = null;

export function getReferenceImageResolver(): ReferenceImageResolver {
  if (!sharedResolver) sharedResolver = new ReferenceImageResolver();
  return sharedResolver;
}
