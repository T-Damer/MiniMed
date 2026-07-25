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

  let totalBytes = 0;
  let downloadedBytes = 0;
  let hasByteTotals = false;
  for (const task of activeTasks) {
    if (!task.totalBytes || task.totalBytes <= 0) continue;
    hasByteTotals = true;
    totalBytes += task.totalBytes;
    downloadedBytes += task.downloadedBytes;
  }

  return {
    publishedCount: published.length,
    installedCount,
    activeTaskCount: activeTasks.length,
    installedFraction:
      published.length > 0 ? Math.max(0, Math.min(1, installedCount / published.length)) : 0,
    byteProgress: hasByteTotals && totalBytes > 0 ? downloadedBytes / totalBytes : null,
  };
}
