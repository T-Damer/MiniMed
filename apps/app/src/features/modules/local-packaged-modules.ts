import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  InstalledContentModule,
} from '@localmed/contracts';

/** Catalog ids that ship as packaged companions and are already mounted at boot. */
export const PACKAGED_COMPANION_MODULE_IDS: ReadonlySet<string> = new Set([
  'minimed.core.ru',
  'minimed.regulatory.pediatrics.ru',
  'minimed.reference.pediatrics.ru',
]);

export function isPreinstalledCatalogModule(module: ContentModuleCatalogEntry): boolean {
  return (
    module.required ||
    module.releaseState === 'bundled' ||
    PACKAGED_COMPANION_MODULE_IDS.has(module.id)
  );
}

export function preinstalledCatalogModule(
  module: ContentModuleCatalogEntry,
): InstalledContentModule {
  return {
    moduleId: module.id,
    version: module.version,
    state: 'installed',
    enabled: true,
    installedAt: null,
    installedSizeBytes: module.sizes.installedBytes,
    activeSourceSetDigest: module.sourceSetDigest,
    previousVersions: [],
    lastValidation: null,
  };
}

export function mergePreinstalledModules(
  catalog: ContentModuleCatalog,
  installed: readonly InstalledContentModule[],
): readonly InstalledContentModule[] {
  const byId = new Map(installed.map((module) => [module.moduleId, module]));
  for (const module of catalog.modules) {
    if (!isPreinstalledCatalogModule(module) || byId.has(module.id)) continue;
    byId.set(module.id, preinstalledCatalogModule(module));
  }
  return [...byId.values()];
}

export function catalogModuleHidesInstallAction(module: ContentModuleCatalogEntry): boolean {
  return isPreinstalledCatalogModule(module);
}

export function catalogModuleHidesRemoveAction(module: ContentModuleCatalogEntry): boolean {
  return isPreinstalledCatalogModule(module) || module.kind === 'tool';
}

export function localPackagedModulesToInstall(
  catalog: ContentModuleCatalog,
  installedIds: ReadonlySet<string>,
  useLocalArtifacts: boolean,
): readonly ContentModuleCatalogEntry[] {
  if (!useLocalArtifacts) return [];
  return catalog.modules.filter(
    (module) =>
      module.kind === 'tool' &&
      module.releaseState === 'published' &&
      !installedIds.has(module.id) &&
      module.artifacts.some((artifact) => artifact.kind === 'index' && Boolean(artifact.url)),
  );
}
