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

export function mergeLocalReferenceDescriptor(
  modules: readonly ContentModuleCatalogEntry[],
  module: ContentModuleCatalogEntry,
): ContentModuleCatalogEntry[] {
  const existing = modules.find((candidate) => candidate.id === module.id);
  if (!existing) return [...modules, module];
  if (JSON.stringify(ContentModuleCatalogEntrySchema.parse(existing)) !== JSON.stringify(module)) {
    throw new Error('Conflicting local reference descriptor.');
  }
  return [...modules];
}

export function withLocalDefinitionReference(
  modules: readonly ContentModuleCatalogEntry[],
): ContentModuleCatalogEntry[] {
  let result = [...modules];
  for (const raw of Object.values(localDescriptors)) {
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
    if (!module.definitionReference || module.releaseState !== 'preview' || module.artifacts.length !== 1) {
      throw new Error('Conflicting local reference descriptor.');
    }
    const base = new URL(import.meta.env.BASE_URL, globalThis.location.href);
    const url = new URL(`content/definition-reference/${raw.fileName}`, base).href;
    result = mergeLocalReferenceDescriptor(result, ContentModuleCatalogEntrySchema.parse({
      ...module,
      artifacts: module.artifacts.map((artifact) => ({ ...artifact, url })),
    }));
  }
  return result;
}
