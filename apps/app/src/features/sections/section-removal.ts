import type { ContentModuleCatalogEntry } from '@localmed/contracts';

import type { Section } from './section-model';

/** What removing one section takes off the device. */
export interface SectionRemovalPlan {
  /** Installed packages to remove: the section's recommendations and the drug groups only it needs. */
  readonly modules: readonly ContentModuleCatalogEntry[];
  /** Storage the removal frees (installed bytes, or the download size when that is not declared). */
  readonly bytes: number;
  /** Installed drug packages left in place because another downloaded section still names them. */
  readonly keptShared: number;
}

function moduleBytes(module: ContentModuleCatalogEntry): number {
  return module.sizes.installedBytes ?? module.sizes.downloadBytes ?? 0;
}

/**
 * A drug group is shared by many sections, so removing a section keeps every package that another
 * section with downloaded recommendations still names: only what nothing else on the device
 * needs is freed.
 */
export function sectionRemovalPlan(
  section: Section,
  sections: readonly Section[],
  isInstalled: (module: ContentModuleCatalogEntry) => boolean,
): SectionRemovalPlan {
  const neededElsewhere = new Set<string>();
  for (const other of sections) {
    if (other.id === section.id || !other.clinical.some(isInstalled)) continue;
    for (const group of other.drugGroups) {
      for (const module of group.modules) neededElsewhere.add(module.id);
    }
  }
  const candidates = new Map<string, ContentModuleCatalogEntry>();
  for (const module of section.clinical) candidates.set(module.id, module);
  for (const group of section.drugGroups) {
    for (const module of group.modules) candidates.set(module.id, module);
  }
  const installed = [...candidates.values()].filter(isInstalled);
  const modules = installed.filter((module) => !neededElsewhere.has(module.id));
  return {
    modules,
    bytes: modules.reduce((sum, module) => sum + moduleBytes(module), 0),
    keptShared: installed.length - modules.length,
  };
}
