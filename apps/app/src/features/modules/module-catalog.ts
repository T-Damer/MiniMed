import {
  type ContentModuleCatalog,
  ContentModuleCatalogEntrySchema,
  ContentModuleCatalogSchema,
} from '@localmed/contracts';

// Raw text keeps the multi-megabyte catalogs on V8's JSON.parse fast path; the bundler would
// otherwise emit them as JavaScript object literals, which are slower to parse at startup.
import catalogText from '@/features/modules/catalog.preview.json?raw';
import terminologyText from '@/features/modules/catalog.terminology.json?raw';

const terminologyModules = ContentModuleCatalogEntrySchema.array().parse(
  JSON.parse(terminologyText),
);
if (new Set(terminologyModules.map((module) => module.id)).size !== terminologyModules.length) {
  throw new Error('Bundled terminology catalog contains duplicate module IDs.');
}

/**
 * Release-generated descriptors: exact membership and gzip/decoded identities, never guessed URLs.
 * Both inputs are already schema-validated; the merge adds only unseen, unique IDs and keeps the
 * base catalog's required core, so re-parsing the ~10 MB result would only repeat startup work.
 */
export function withBundledTerminology(catalog: ContentModuleCatalog): ContentModuleCatalog {
  const known = new Set(catalog.modules.map((module) => module.id));
  return {
    ...catalog,
    modules: [...catalog.modules, ...terminologyModules.filter((module) => !known.has(module.id))],
  };
}

/** The release catalog without bundled terminology, for loaders that merge terminology later. */
export const BASE_MODULE_CATALOG = ContentModuleCatalogSchema.parse(JSON.parse(catalogText));

export const MODULE_CATALOG = withBundledTerminology(BASE_MODULE_CATALOG);

export const REMOTE_MODULE_CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';

// Startup code imports these from the small shell; re-exported for module-feature callers.
export { BUNDLED_CORE_MODULE, TOOL_CATALOG } from '@/features/modules/module-catalog-shell';

export function moduleForTool(toolId: string) {
  return MODULE_CATALOG.modules.find((module) =>
    (module.tools ?? []).some((tool) => tool.id === toolId),
  );
}
