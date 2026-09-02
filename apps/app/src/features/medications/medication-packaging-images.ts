import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import type JSZip from 'jszip';

import { readActiveInstalledSourceAssets } from '@/features/modules/browser-module-runtime';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { safePackagingImageReference } from './medication-record';

export const MEDICATION_PACKAGING_IMAGES_MODULE_ID = 'minimed.medications.packaging-images.ru';
export const ALLMED_SOURCE_URL = 'https://allmed.pro/';

export function medicationPackagingImagesDownloadBytes(
  module: ContentModuleCatalogEntry,
): number | null {
  return module.sizes.downloadBytes ?? module.sizes.sourceAssetsDownloadBytes;
}

interface ManifestImageRecord {
  readonly sourceUrl: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly size: number;
}

interface ParsedImageArchive {
  readonly archive: JSZip;
  readonly images: ReadonlyMap<string, ManifestImageRecord>;
}

export interface ResolvedMedicationPackagingImage {
  readonly reference: string;
  readonly url: string;
  readonly sourceUrl: string;
  readonly contentType: string;
}

export interface MedicationPackagingImageResolverOptions {
  readonly moduleId?: string;
  readonly artifactId?: string;
  readonly readSourceAssets?: (moduleId: string, artifactId?: string) => Promise<Uint8Array | null>;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function imageSourceUrl(reference: string): string {
  return new URL(reference, ALLMED_SOURCE_URL).href;
}

function isAllmedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://allmed.pro' && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function manifestImageRecord(reference: string, value: unknown): ManifestImageRecord | null {
  const record = recordValue(value);
  const sourceUrl = stringValue(record?.['sourceUrl']);
  const contentType = stringValue(record?.['contentType']);
  const sha256 = stringValue(record?.['sha256']);
  const size = record?.['size'];
  if (
    !sourceUrl ||
    !contentType ||
    !/^image\/[a-z0-9.+-]+$/iu.test(contentType) ||
    !sha256 ||
    !/^sha256:[a-f0-9]{64}$/u.test(sha256) ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 1
  ) {
    return null;
  }
  try {
    if (new URL(sourceUrl).href !== imageSourceUrl(reference)) return null;
  } catch {
    return null;
  }
  return { sourceUrl, contentType, sha256, size };
}

function parseManifest(value: unknown): ReadonlyMap<string, ManifestImageRecord> | null {
  const manifest = recordValue(value);
  const sourceUrl = stringValue(manifest?.['sourceUrl']);
  const images = recordValue(manifest?.['images']);
  if (!sourceUrl || !isAllmedOrigin(sourceUrl) || !images) return null;

  const result = new Map<string, ManifestImageRecord>();
  for (const [reference, record] of Object.entries(images)) {
    if (safePackagingImageReference(reference) !== reference) continue;
    const parsed = manifestImageRecord(reference, record);
    if (parsed) result.set(reference, parsed);
  }
  return result;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return `sha256:${[...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

export class MedicationPackagingImageResolver {
  private readonly moduleId: string;
  private readonly artifactId: string | undefined;
  private readonly readSourceAssets: (
    moduleId: string,
    artifactId?: string,
  ) => Promise<Uint8Array | null>;
  private readonly archives = new Map<string, Promise<ParsedImageArchive | null>>();
  private readonly images = new Map<string, Promise<ResolvedMedicationPackagingImage | null>>();
  private readonly objectUrls = new Set<string>();
  private readonly handleContentChanged = (): void => {
    this.clear();
  };

  public constructor(options: MedicationPackagingImageResolverOptions = {}) {
    this.moduleId = options.moduleId ?? MEDICATION_PACKAGING_IMAGES_MODULE_ID;
    this.artifactId = options.artifactId;
    this.readSourceAssets = options.readSourceAssets ?? readActiveInstalledSourceAssets;
    if (typeof window !== 'undefined') {
      window.addEventListener(CONTENT_CHANGED_EVENT, this.handleContentChanged);
    }
  }

  private cacheKey(): string {
    return `${this.moduleId}\u001f${this.artifactId ?? ''}`;
  }

  private async loadArchive(): Promise<ParsedImageArchive | null> {
    const bytes = await this.readSourceAssets(this.moduleId, this.artifactId);
    if (!bytes) return null;
    const jsZip = await import('jszip');
    const archive = await jsZip.default.loadAsync(Uint8Array.from(bytes));
    const manifestFile = archive.file('manifest.json');
    if (!manifestFile || manifestFile.dir) return null;
    const manifestText = await manifestFile.async('text');
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      return null;
    }
    const images = parseManifest(manifest);
    return images ? { archive, images } : null;
  }

  private archive(): Promise<ParsedImageArchive | null> {
    const key = this.cacheKey();
    let pending = this.archives.get(key);
    if (!pending) {
      pending = this.loadArchive();
      this.archives.set(key, pending);
    }
    return pending;
  }

  private async loadImage(reference: string): Promise<ResolvedMedicationPackagingImage | null> {
    const parsed = await this.archive();
    const manifestImage = parsed?.images.get(reference);
    if (!parsed || !manifestImage) return null;
    const file = parsed.archive.file(reference);
    if (!file || file.dir || (file.unsafeOriginalName && file.unsafeOriginalName !== reference)) {
      return null;
    }
    const bytes = await file.async('uint8array');
    if (bytes.byteLength !== manifestImage.size || (await digest(bytes)) !== manifestImage.sha256) {
      return null;
    }
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    const url = URL.createObjectURL(
      new Blob([blobBytes.buffer], { type: manifestImage.contentType }),
    );
    this.objectUrls.add(url);
    return {
      reference,
      url,
      sourceUrl: manifestImage.sourceUrl,
      contentType: manifestImage.contentType,
    };
  }

  public resolve(referenceValue: unknown): Promise<ResolvedMedicationPackagingImage | null> {
    const reference = safePackagingImageReference(referenceValue);
    if (!reference) return Promise.resolve(null);
    const key = `${this.cacheKey()}\u001f${reference}`;
    let pending = this.images.get(key);
    if (!pending) {
      pending = this.loadImage(reference).catch(() => null);
      this.images.set(key, pending);
    }
    return pending;
  }

  public clear(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.archives.clear();
    this.images.clear();
  }

  public dispose(): void {
    this.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener(CONTENT_CHANGED_EVENT, this.handleContentChanged);
    }
  }
}

let sharedResolver: MedicationPackagingImageResolver | null = null;

export function getMedicationPackagingImageResolver(): MedicationPackagingImageResolver {
  if (!sharedResolver) sharedResolver = new MedicationPackagingImageResolver();
  return sharedResolver;
}

export function resolveMedicationPackagingImage(
  reference: unknown,
): Promise<ResolvedMedicationPackagingImage | null> {
  return getMedicationPackagingImageResolver().resolve(reference);
}
