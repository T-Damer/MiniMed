import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  InstalledContentModule,
} from '@localmed/contracts';

import type { OverviewDocumentCounts } from '@/features/modules/overview-document-counts';

export const MEDICATIONS_COMPANION_MODULE_ID = 'minimed.medications.ru';

/** Core ships eight registry summary cards without the Allmed medications companion. */
export const CORE_MEDICATION_REGISTRY_CARD_COUNT = 8;

export interface PreinstalledCatalogModuleOptions {
  readonly companionMedicationsMounted?: boolean;
}

export function isCompanionMedicationsMounted(counts: OverviewDocumentCounts | undefined): boolean {
  return (counts?.medications ?? 0) > CORE_MEDICATION_REGISTRY_CARD_COUNT;
}

export function isPreinstalledCatalogModule(
  module: ContentModuleCatalogEntry,
  options?: PreinstalledCatalogModuleOptions,
): boolean {
  return (
    module.required ||
    module.releaseState === 'bundled' ||
    module.id === 'minimed.core.ru' ||
    (module.id === MEDICATIONS_COMPANION_MODULE_ID && options?.companionMedicationsMounted === true)
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
  options?: PreinstalledCatalogModuleOptions,
): readonly InstalledContentModule[] {
  const byId = new Map(installed.map((module) => [module.moduleId, module]));
  for (const module of catalog.modules) {
    if (!isPreinstalledCatalogModule(module, options) || byId.has(module.id)) continue;
    byId.set(module.id, preinstalledCatalogModule(module));
  }
  return [...byId.values()];
}

export function catalogModuleHidesInstallAction(
  module: ContentModuleCatalogEntry,
  options?: PreinstalledCatalogModuleOptions,
): boolean {
  return isPreinstalledCatalogModule(module, options);
}

export function catalogModuleHidesRemoveAction(
  module: ContentModuleCatalogEntry,
  options?: PreinstalledCatalogModuleOptions,
): boolean {
  return isPreinstalledCatalogModule(module, options) || module.kind === 'tool';
}

export function localPackagedModulesToInstall(
  catalog: ContentModuleCatalog,
  installedIds: ReadonlySet<string>,
): readonly ContentModuleCatalogEntry[] {
  return catalog.modules.filter(
    (module) =>
      module.kind === 'tool' &&
      module.releaseState === 'published' &&
      !installedIds.has(module.id) &&
      module.artifacts.some((artifact) => artifact.kind === 'index' && Boolean(artifact.url)),
  );
}
