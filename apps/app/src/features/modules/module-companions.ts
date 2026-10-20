import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';

import { instructionModuleIdForSubstanceModule } from '@/features/medications/instruction-source';

/**
 * Modules that install together with a requested one, so a doctor downloads once (owner 2026-10-20:
 * «open a drug → install its module → then install its instructions separately» is an
 * antipattern). A drug group's registry module (ЕСКЛП) brings the same group's official
 * instructions: the drug screen and the prescription read doses only from them.
 */
export function companionModuleIds(moduleId: string): readonly string[] {
  const instructions = instructionModuleIdForSubstanceModule(moduleId);
  return instructions ? [instructions] : [];
}

const ACTIVE_STATES: ReadonlySet<ContentModuleDownloadTask['state']> = new Set([
  'queued',
  'downloading',
  'verifying',
  'installing',
]);

/**
 * The catalog entries to install beside `moduleId`: released companions that are neither installed
 * nor already on their way. A companion missing from the catalog is simply not offered.
 */
export function companionModulesToInstall(input: {
  readonly moduleId: string;
  readonly catalogModules: readonly ContentModuleCatalogEntry[];
  readonly installedModuleIds: ReadonlySet<string>;
  readonly tasks: readonly Pick<ContentModuleDownloadTask, 'moduleId' | 'state'>[];
  readonly isReleased: (module: ContentModuleCatalogEntry) => boolean;
}): readonly ContentModuleCatalogEntry[] {
  return companionModuleIds(input.moduleId).flatMap((id) => {
    if (input.installedModuleIds.has(id)) return [];
    if (input.tasks.some((task) => task.moduleId === id && ACTIVE_STATES.has(task.state))) {
      return [];
    }
    const module = input.catalogModules.find((entry) => entry.id === id);
    return module && input.isReleased(module) ? [module] : [];
  });
}
