import type {
  ContentModuleCatalogEntry,
  ContentModuleCategory,
  ContentModuleDownloadTask,
} from '@localmed/contracts';

export function modulesInCategory(
  modules: readonly ContentModuleCatalogEntry[],
  categoryId: string,
): readonly ContentModuleCatalogEntry[] {
  return modules.filter(
    (module) => module.collection === categoryId || module.tags.includes(categoryId),
  );
}

export interface RecommendationCategoryStats {
  readonly publishedCount: number;
  readonly installedCount: number;
  readonly pendingCount: number;
  readonly downloadBytes: number;
}

export function recommendationCategoryStats(
  modules: readonly ContentModuleCatalogEntry[],
  category: ContentModuleCategory,
  installedModuleIds: ReadonlySet<string>,
): RecommendationCategoryStats {
  const published = modulesInCategory(modules, category.id).filter(
    (module) => module.releaseState === 'published',
  );
  const installedCount = published.filter((module) => installedModuleIds.has(module.id)).length;

  return {
    publishedCount: published.length,
    installedCount,
    pendingCount: published.length - installedCount,
    downloadBytes: published.reduce((sum, module) => sum + (module.sizes.downloadBytes ?? 0), 0),
  };
}

const TERMINAL_TASK_STATES = new Set<ContentModuleDownloadTask['state']>([
  'completed',
  'failed',
  'cancelled',
]);

export interface RecommendationCategoryDownloadProgress {
  readonly publishedCount: number;
  readonly installedCount: number;
  readonly activeTaskCount: number;
  readonly installedFraction: number;
  readonly byteProgress: number | null;
}

export function recommendationCategoryDownloadProgress(
  modules: readonly ContentModuleCatalogEntry[],
  categoryId: string,
  installedModuleIds: ReadonlySet<string>,
  tasks: readonly ContentModuleDownloadTask[],
): RecommendationCategoryDownloadProgress {
  const published = modulesInCategory(modules, categoryId).filter(
    (module) => module.releaseState === 'published',
  );
  const publishedIds = new Set(published.map((module) => module.id));
  const installedCount = published.filter((module) => installedModuleIds.has(module.id)).length;
  const activeTasks = tasks.filter(
    (task) => publishedIds.has(task.moduleId) && !TERMINAL_TASK_STATES.has(task.state),
  );

  const hasCatalogByteTotals = published.every(
    (module) => module.sizes.downloadBytes !== null && module.sizes.downloadBytes > 0,
  );
  const totalBytes = published.reduce((sum, module) => sum + (module.sizes.downloadBytes ?? 0), 0);
  const downloadedBytes = published.reduce((sum, module) => {
    const moduleBytes = module.sizes.downloadBytes ?? 0;
    if (installedModuleIds.has(module.id)) return sum + moduleBytes;
    const task = activeTasks.find((candidate) => candidate.moduleId === module.id);
    if (!task?.totalBytes || task.totalBytes <= 0) return sum;
    const taskFraction = Math.max(0, Math.min(1, task.downloadedBytes / task.totalBytes));
    return sum + moduleBytes * taskFraction;
  }, 0);

  return {
    publishedCount: published.length,
    installedCount,
    activeTaskCount: activeTasks.length,
    installedFraction:
      published.length > 0 ? Math.max(0, Math.min(1, installedCount / published.length)) : 0,
    byteProgress:
      activeTasks.length > 0 && hasCatalogByteTotals && totalBytes > 0
        ? downloadedBytes / totalBytes
        : null,
  };
}
