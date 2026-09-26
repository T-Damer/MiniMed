import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ToolCatalogEntry,
} from '@localmed/contracts';

export const BUNDLED_CORE_MODULE_ID = 'minimed.core.ru';

/**
 * The part of the release catalog that startup code reads synchronously: the bundled core
 * descriptor and the tool index. It stays ~150 KB while the full catalog, with exact document
 * membership and terminology, is ~10 MB and is loaded only when module features need it.
 */
export interface ModuleCatalogShell {
  readonly catalogVersion: string;
  readonly publishedAt: string;
  readonly coreModule: ContentModuleCatalogEntry;
  readonly tools: readonly {
    readonly moduleId: string;
    readonly tool: ToolCatalogEntry;
  }[];
}

export function deriveModuleCatalogShell(catalog: ContentModuleCatalog): ModuleCatalogShell {
  const coreModule = catalog.modules.find((module) => module.id === BUNDLED_CORE_MODULE_ID);
  if (!coreModule) throw new Error('Release catalog has no bundled core module.');
  return {
    catalogVersion: catalog.catalogVersion,
    publishedAt: catalog.publishedAt,
    coreModule,
    tools: catalog.modules.flatMap((module) =>
      (module.tools ?? []).map((tool) => ({ moduleId: module.id, tool })),
    ),
  };
}
