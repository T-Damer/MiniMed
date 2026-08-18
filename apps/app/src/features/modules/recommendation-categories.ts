import type {
  ContentModuleCatalogEntry,
  ContentModuleCategory,
  ContentModuleDownloadTask,
  InstalledContentModule,
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
  readonly installedBytes: number;
}

export interface ModuleCollectionStats {
  readonly moduleCount: number;
  readonly installedCount: number;
  readonly downloadBytes: number;
  readonly installedBytes: number;
}

function sumCatalogDownloadBytes(modules: readonly ContentModuleCatalogEntry[]): number {
  return modules.reduce((sum, module) => sum + (module.sizes.downloadBytes ?? 0), 0);
}

function sumInstalledModuleBytes(
  modules: readonly ContentModuleCatalogEntry[],
  installedById: ReadonlyMap<string, InstalledContentModule>,
): number {
  return modules.reduce((sum, module) => {
    if (!installedById.has(module.id)) return sum;
    const installedBytes = installedById.get(module.id)?.installedSizeBytes;
    if (installedBytes !== null && installedBytes !== undefined) return sum + installedBytes;
    if (module.sizes.installedBytes !== null) return sum + module.sizes.installedBytes;
    return sum;
  }, 0);
}

export function moduleCollectionStats(
  modules: readonly ContentModuleCatalogEntry[],
  installedById: ReadonlyMap<string, InstalledContentModule>,
  options?: { readonly publishedOnly?: boolean },
): ModuleCollectionStats {
  const scoped = options?.publishedOnly
    ? modules.filter((module) => module.releaseState === 'published')
    : modules;
  const installedCount = scoped.filter((module) => installedById.has(module.id)).length;

  return {
    moduleCount: scoped.length,
    installedCount,
    downloadBytes: sumCatalogDownloadBytes(scoped),
    installedBytes: sumInstalledModuleBytes(scoped, installedById),
  };
}

export function recommendationCategoryStats(
  modules: readonly ContentModuleCatalogEntry[],
  category: ContentModuleCategory,
  installedById: ReadonlyMap<string, InstalledContentModule>,
): RecommendationCategoryStats {
  const published = modulesInCategory(modules, category.id).filter(
    (module) => module.releaseState === 'published',
  );
  const stats = moduleCollectionStats(published, installedById);

  return {
    publishedCount: stats.moduleCount,
    installedCount: stats.installedCount,
    pendingCount: stats.moduleCount - stats.installedCount,
    downloadBytes: stats.downloadBytes,
    installedBytes: stats.installedBytes,
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
