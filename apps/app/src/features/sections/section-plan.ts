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
  return {
    modules,
    plan: moduleDownloadPlan(modules, isInstalled),
    install: installState(modules, isInstalled),
    queue: moduleGroupTaskState(modules, tasks),
    progress: moduleGroupDownloadProgress(modules, installedIds, tasks),
  };
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
