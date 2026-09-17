import {
  type ContentModuleCatalog,
  ContentModuleCatalogEntrySchema,
  ContentModuleCatalogSchema,
} from '@localmed/contracts';

import rawCatalog from '@/features/modules/catalog.preview.json';
import rawTerminologyModules from '@/features/modules/catalog.terminology.json';

const terminologyModules = ContentModuleCatalogEntrySchema.array().parse(rawTerminologyModules);

/** Release-generated descriptors: exact membership and gzip/decoded identities, never guessed URLs. */
export function withBundledTerminology(catalog: ContentModuleCatalog): ContentModuleCatalog {
  const known = new Set(catalog.modules.map((module) => module.id));
  return ContentModuleCatalogSchema.parse({
    ...catalog,
    modules: [...catalog.modules, ...terminologyModules.filter((module) => !known.has(module.id))],
  });
}

export const MODULE_CATALOG = withBundledTerminology(ContentModuleCatalogSchema.parse(rawCatalog));

const bundledCoreModule = MODULE_CATALOG.modules.find((module) => module.id === 'minimed.core.ru');

if (!bundledCoreModule?.sourceSetDigest || bundledCoreModule.sizes.installedBytes === null) {
  throw new Error('Bundled core catalog metadata is incomplete.');
}

export const BUNDLED_CORE_MODULE = {
  ...bundledCoreModule,
  sourceSetDigest: bundledCoreModule.sourceSetDigest,
  sizes: { ...bundledCoreModule.sizes, installedBytes: bundledCoreModule.sizes.installedBytes },
};

export const REMOTE_MODULE_CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';

/** Always shipped with core discovery; these entries do not imply an installed tool payload. */
export const TOOL_CATALOG = MODULE_CATALOG.modules.flatMap((module) => module.tools ?? []);

export function moduleForTool(toolId: string) {
  return MODULE_CATALOG.modules.find((module) =>
    (module.tools ?? []).some((tool) => tool.id === toolId),
  );
}
