import {
  type ContentModuleCatalog,
  type ContentModuleCatalogEntry,
  hasDownloadableModuleIndex,
  hasLocalModuleArtifacts,
  type InstalledContentModule,
} from '@localmed/contracts';
import { getExperimentalModulesEnabled } from '@/state/app-preferences';

export const MEDICATIONS_COMPANION_MODULE_ID = 'minimed.medications.ru';
// Exact size of the bundled local Allmed companion; update when that packaged artifact changes.
export const PACKAGED_MEDICATIONS_SIZE_BYTES = 514_322_432;

/**
 * A module the catalog lets the user install right now: everything published,
 * plus preview ("Experimental") packs while the settings toggle is on. A module installed from a
 * file is never offered: its bytes exist only in the file the owner picks.
 */
export function isModuleReleased(
  module: Pick<ContentModuleCatalogEntry, 'releaseState' | 'artifacts' | 'sourceSetDigest'>,
): boolean {
  return isModuleReleasedWith(module, getExperimentalModulesEnabled());
}

/**
 * {@link isModuleReleased} for a loop over the catalog: the caller reads the «Experimental» switch
 * once (each read touches storage) and passes it in.
 */
export function isModuleReleasedWith(
  module: Pick<ContentModuleCatalogEntry, 'releaseState' | 'artifacts' | 'sourceSetDigest'>,
  experimentalEnabled: boolean,
): boolean {
  return (
    hasDownloadableModuleIndex(module) &&
    !hasLocalModuleArtifacts(module) &&
    (module.releaseState === 'published' ||
      (module.releaseState === 'preview' && experimentalEnabled))
  );
}

export interface PreinstalledCatalogModuleOptions {
  readonly companionMedicationsMounted?: boolean;
}

export function isCompanionMedicationsMounted(contentPackIds: readonly string[]): boolean {
  return contentPackIds.includes(MEDICATIONS_COMPANION_MODULE_ID);
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
    installedSizeBytes:
      module.id === MEDICATIONS_COMPANION_MODULE_ID
        ? PACKAGED_MEDICATIONS_SIZE_BYTES
        : module.sizes.installedBytes,
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

export function contentModuleNeedsInstall(
  module: ContentModuleCatalogEntry,
  installed: InstalledContentModule | undefined,
): boolean {
  return (
    !installed ||
    installed.version !== module.version ||
    installed.activeSourceSetDigest !== module.sourceSetDigest
  );
}

export function localPackagedModulesToInstall(
  catalog: ContentModuleCatalog,
  installedModules: ReadonlyMap<string, InstalledContentModule>,
): readonly ContentModuleCatalogEntry[] {
  return catalog.modules.filter((module) => {
    const installed = installedModules.get(module.id);
    const autoInstallable = installed !== undefined && isModuleReleased(module);
    return (
      module.kind === 'tool' &&
      autoInstallable &&
      contentModuleNeedsInstall(module, installed) &&
      hasDownloadableModuleIndex(module)
    );
  });
}
