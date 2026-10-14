import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';

import {
  moduleGroupDownloadProgress,
  moduleGroupTaskState,
  type RecommendationCategoryDownloadProgress,
} from '@/features/modules/recommendation-categories';
import {
  type DrugDownloadPlan,
  formatDownloadSize,
  moduleDownloadPlan,
} from '@/features/onboarding/onboarding-downloads';
import {
  installState,
  type Section,
  type SectionInstallState,
  sectionContentsLabel,
  sectionModules,
} from './section-model';

/** What the list shows for one section under the current selection, installs and queue. */
export interface SectionStatus {
  readonly modules: readonly ContentModuleCatalogEntry[];
  /** Only what is not installed yet: an installed part is never counted again. */
  readonly plan: DrugDownloadPlan;
  readonly install: SectionInstallState;
  readonly queue: 'queued' | 'active' | null;
  readonly progress: RecommendationCategoryDownloadProgress;
}

export function sectionStatus(
  section: Section,
  skipped: ReadonlySet<string>,
  isInstalled: (module: ContentModuleCatalogEntry) => boolean,
  tasks: readonly ContentModuleDownloadTask[],
): SectionStatus {
  const modules = sectionModules(section, skipped);
  const installedIds = new Set(modules.filter(isInstalled).map((module) => module.id));
  const queued = queueModules(section, modules, isInstalled);
  return {
    modules,
    plan: moduleDownloadPlan(modules, isInstalled),
    install: installState(modules, isInstalled),
    queue: moduleGroupTaskState(queued, tasks),
    progress: moduleGroupDownloadProgress(queued, installedIds, tasks),
  };
}

/**
 * The packages whose queue state a section row may show. A drug group is shared by many sections,
 * so a group in flight for one section must not make every other section that lists it look
 * queued: a section shows the queue of its own recommendations, and only once those are all
 * installed the queue of the drug groups that are still missing.
 */
function queueModules(
  section: Section,
  modules: readonly ContentModuleCatalogEntry[],
  isInstalled: (module: ContentModuleCatalogEntry) => boolean,
): readonly ContentModuleCatalogEntry[] {
  const ownIds = new Set(section.clinical.map((module) => module.id));
  const own = modules.filter((module) => ownIds.has(module.id));
  return own.some((module) => !isInstalled(module)) ? own : modules;
}

/** «210 МБ» still to download, «ещё 80 МБ» when part is installed, «скачано» when all is. */
export function pendingSizeLabel(plan: DrugDownloadPlan, install: SectionInstallState): string {
  if (install === 'complete') return 'скачано';
  if (plan.bytes === null) return '';
  const size = formatDownloadSize(plan.bytes);
  return install === 'partial' ? `ещё ${size}` : size;
}

/** «35 клинических рекомендаций · препараты: 3 группы · 210 МБ». */
export function sectionSummary(
  section: Section,
  skipped: ReadonlySet<string>,
  status: SectionStatus,
): string {
  return [sectionContentsLabel(section, skipped), pendingSizeLabel(status.plan, status.install)]
    .filter((part) => part !== '')
    .join(' · ');
}

/** The footer total for the ticked sections: shared packages once, installed ones not at all. */
export function selectionTotalLabel(selectedSectionCount: number, plan: DrugDownloadPlan): string {
  if (selectedSectionCount === 0) return 'Выберите раздел';
  if (plan.pending.length === 0) return 'Выбранное уже скачано';
  const size = plan.bytes === null ? '' : ` · ${formatDownloadSize(plan.bytes)}`;
  return `Скачать выбранное${size}`;
}
