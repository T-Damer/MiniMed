import {
  type ContentModuleCatalogEntry,
  ContentModuleCatalogEntrySchema,
} from '@localmed/contracts';

// Only a descriptor enters JS. Source text stays in the explicitly installed SQLite file.
const localDescriptors = import.meta.env.DEV
  ? import.meta.glob('./catalog.definition-reference.local.json', {
      eager: true,
      import: 'default',
    })
  : {};

/**
 * DEV only: a developer's own build of the reference replaces the published experimental entry
 * with the same module id, so local editions can be tested without editing the release catalog.
 */
export function mergeLocalReferenceDescriptor(
  modules: readonly ContentModuleCatalogEntry[],
  module: ContentModuleCatalogEntry,
): ContentModuleCatalogEntry[] {
  if (!modules.some((candidate) => candidate.id === module.id)) return [...modules, module];
  return modules.map((candidate) => (candidate.id === module.id ? module : candidate));
}

/**
 * Merges local descriptors (the parsed `catalog.definition-reference.local.json`) into the
 * catalog. The archive is served next to the page, so without a page URL — unit tests or any
 * other non-browser context — there is nowhere to install it from and the catalog is unchanged.
 */
export function applyLocalReferenceDescriptors(
  modules: readonly ContentModuleCatalogEntry[],
  descriptors: readonly unknown[],
  pageUrl: string | undefined,
  baseUrl = './',
): ContentModuleCatalogEntry[] {
  let result = [...modules];
  if (!pageUrl) return result;
  for (const raw of descriptors) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('module' in raw) ||
      !('fileName' in raw) ||
      typeof raw.fileName !== 'string' ||
      !/^[a-z0-9.-]+\.db\.gz$/u.test(raw.fileName)
    ) {
      throw new Error('Invalid local reference descriptor. Rebuild the local edition.');
    }
    const module = ContentModuleCatalogEntrySchema.parse(raw.module);
    if (
      !module.definitionReference ||
      module.releaseState !== 'preview' ||
      module.artifacts.length !== 1
    ) {
      throw new Error('Conflicting local reference descriptor.');
    }
    const base = new URL(baseUrl, pageUrl);
    const url = new URL(`content/definition-reference/${raw.fileName}`, base).href;
    result = mergeLocalReferenceDescriptor(
      result,
      ContentModuleCatalogEntrySchema.parse({
        ...module,
        artifacts: module.artifacts.map((artifact) => ({ ...artifact, url })),
      }),
    );
  }
  return result;
}

export function withLocalDefinitionReference(
  modules: readonly ContentModuleCatalogEntry[],
): ContentModuleCatalogEntry[] {
  return applyLocalReferenceDescriptors(
    modules,
    Object.values(localDescriptors),
    globalThis.location?.href,
    import.meta.env.BASE_URL,
  );
}
