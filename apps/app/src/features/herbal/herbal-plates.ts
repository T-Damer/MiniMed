import type JSZip from 'jszip';

import { readActiveInstalledSourceAssets } from '@/features/modules/browser-module-runtime';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { HERBAL_PLATES_MODULE_ID } from './herbal-chapter';

/**
 * The botanical plates of the herbal book: one STORED ZIP (`manifest.json` + `plates/<id>.jpg`)
 * from the optional module `minimed.reference.herbal.plates`. A plate is opened only when its
 * bytes match the manifest's size and SHA-256; without the module there is no plate and the
 * chapter keeps its small thumbnail.
 */

interface PlateRecord {
  readonly sha256: string;
  readonly size: number;
}

interface PlateArchive {
  readonly archive: JSZip;
  readonly plates: ReadonlyMap<string, PlateRecord>;
}

export interface HerbalPlateResolverOptions {
  readonly readSourceAssets?: (moduleId: string) => Promise<Uint8Array | null>;
}

function parseManifest(value: unknown): ReadonlyMap<string, PlateRecord> | null {
  if (typeof value !== 'object' || value === null) return null;
  const images = (value as Record<string, unknown>)['images'];
  if (typeof images !== 'object' || images === null) return null;
  const plates = new Map<string, PlateRecord>();
  for (const [name, raw] of Object.entries(images as Record<string, unknown>)) {
    if (!/^plates\/[a-z0-9-]+\.jpg$/u.test(name) || typeof raw !== 'object' || raw === null) {
      continue;
    }
    const item = raw as Record<string, unknown>;
    const sha256 = item['sha256'];
    const size = item['size'];
    if (typeof sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(sha256)) continue;
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) continue;
    plates.set(name, { sha256, size });
  }
  return plates;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer));
  return `sha256:${[...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export class HerbalPlateResolver {
  private readonly readSourceAssets: (moduleId: string) => Promise<Uint8Array | null>;
  private archive: Promise<PlateArchive | null> | null = null;
  private readonly urls = new Map<string, Promise<string | null>>();
  private readonly objectUrls = new Set<string>();
  private readonly handleContentChanged = (): void => {
    this.clear();
  };

  public constructor(options: HerbalPlateResolverOptions = {}) {
    this.readSourceAssets =
      options.readSourceAssets ?? ((moduleId: string) => readActiveInstalledSourceAssets(moduleId));
    if (typeof window !== 'undefined') {
      window.addEventListener(CONTENT_CHANGED_EVENT, this.handleContentChanged);
    }
  }

  private async loadArchive(): Promise<PlateArchive | null> {
    const bytes = await this.readSourceAssets(HERBAL_PLATES_MODULE_ID);
    if (!bytes) return null;
    const jsZip = await import('jszip');
    const archive = await jsZip.default.loadAsync(bytes);
    const manifestFile = archive.file('manifest.json');
    if (!manifestFile || manifestFile.dir) return null;
    let manifest: unknown;
    try {
      manifest = JSON.parse(await manifestFile.async('text'));
    } catch {
      return null;
    }
    const plates = parseManifest(manifest);
    return plates ? { archive, plates } : null;
  }

  private async loadPlate(asset: string): Promise<string | null> {
    this.archive ??= this.loadArchive();
    const parsed = await this.archive;
    const record = parsed?.plates.get(asset);
    const file = parsed?.archive.file(asset);
    if (!record || !file || file.dir) return null;
    const bytes = await file.async('uint8array');
    if (bytes.byteLength !== record.size || (await sha256(bytes)) !== record.sha256) return null;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'image/jpeg' }));
    this.objectUrls.add(url);
    return url;
  }

  /** An object URL of the plate, or null when the plates module is not installed. */
  public resolve(asset: string): Promise<string | null> {
    let pending = this.urls.get(asset);
    if (!pending) {
      pending = this.loadPlate(asset).catch(() => null);
      this.urls.set(asset, pending);
    }
    return pending;
  }

  public clear(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.urls.clear();
    this.archive = null;
  }
}

let shared: HerbalPlateResolver | null = null;

export function getHerbalPlateResolver(): HerbalPlateResolver {
  shared ??= new HerbalPlateResolver();
  return shared;
}
