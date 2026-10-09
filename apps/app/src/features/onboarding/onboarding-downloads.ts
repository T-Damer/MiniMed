import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import { z } from 'zod';

/** Pure helpers for the tour's optional downloads and its sample MRI. */

/** The packages of the «Препараты» section, exactly as the section's own download selects them. */
export function drugModules(
  catalog: ContentModuleCatalog,
  released: (module: ContentModuleCatalogEntry) => boolean,
): readonly ContentModuleCatalogEntry[] {
  return catalog.modules.filter((module) => module.kind === 'medication' && released(module));
}

export interface DrugDownloadPlan {
  readonly pending: readonly ContentModuleCatalogEntry[];
  /** Bytes still to download; null when some pending package has no declared size. */
  readonly bytes: number | null;
  readonly complete: boolean;
}

/** Declared download sizes summed; null when any package has no declared size. */
export function totalDownloadBytes(modules: readonly ContentModuleCatalogEntry[]): number | null {
  const sizes = modules.map((module) => module.sizes.downloadBytes);
  return sizes.every((size): size is number => size !== null)
    ? sizes.reduce((sum, size) => sum + size, 0)
    : null;
}

/** What of a set of packages is still to download; the size counts only what is missing. */
export function moduleDownloadPlan(
  modules: readonly ContentModuleCatalogEntry[],
  installed: (module: ContentModuleCatalogEntry) => boolean,
): DrugDownloadPlan {
  const pending = modules.filter((module) => !installed(module));
  return {
    pending,
    bytes: totalDownloadBytes(pending),
    complete: modules.length > 0 && pending.length === 0,
  };
}

const MIB = 1024 * 1024;
const GIB = MIB * 1024;

function decimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** «1,9 ГБ», «286 МБ», «4,8 МБ»: a size for a button label, with a decimal comma. */
export function formatDownloadSize(bytes: number): string {
  if (bytes >= GIB) return `${decimal(bytes / GIB)} ГБ`;
  const megabytes = bytes / MIB;
  return `${megabytes >= 10 ? Math.round(megabytes) : decimal(megabytes)} МБ`;
}

/** Downloads over this size get a «лучше по Wi‑Fi» hint. */
export const LARGE_DOWNLOAD_BYTES = 500 * MIB;

const MriManifestSchema = z.object({
  modality: z.string().min(1),
  region: z.string().min(1),
  sequence: z.string().min(1),
  plane: z.string().min(1),
  slices: z.array(z.string().regex(/^[\w.-]+\.webp$/u)).min(1),
  source: z.object({
    title: z.string().min(1),
    url: z.string().url(),
    author: z.string().min(1),
    license: z.string().min(1),
    licenseUrl: z.string().url(),
  }),
});

export type MriManifest = z.infer<typeof MriManifestSchema>;

/** Parses the manifest shipped next to the slices; undefined when it is not what was promised. */
export function parseMriManifest(value: unknown): MriManifest | undefined {
  const parsed = MriManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** «Название · набор данных · лицензия · первый автор и др.» from the manifest's source block. */
export function mriAttribution(manifest: MriManifest): string {
  const { title, author, license } = manifest.source;
  const paren = /^(.*?)\s*\(([^)]+)\)/u.exec(title);
  const name = paren?.[1] ?? title;
  const dataset = paren?.[2];
  const licenseName = license.split(/\s*\(/u)[0] ?? license;
  const authors = author.split(',').map((part) => part.trim());
  const first = authors[0] ?? author;
  return [name, dataset, licenseName, authors.length > 1 ? `${first} и др.` : first]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
