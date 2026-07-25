import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';

const STORAGE_KEY = 'minimed.pending-module-installs.v1';

export interface PendingModuleInstall {
  readonly moduleId: string;
  readonly version: string;
  readonly includeSourceAssets: boolean;
  readonly queuedAt: string;
}

function installKey(moduleId: string, version: string): string {
  return `${moduleId}@${version}`;
}

function readQueue(): PendingModuleInstall[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PendingModuleInstall => {
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof item.moduleId === 'string' &&
        typeof item.version === 'string' &&
        typeof item.includeSourceAssets === 'boolean' &&
        typeof item.queuedAt === 'string'
      );
    });
  } catch {
    return [];
  }
}

function writeQueue(queue: readonly PendingModuleInstall[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function enqueuePendingModuleInstall(
  moduleId: string,
  version: string,
  includeSourceAssets: boolean,
): void {
  const key = installKey(moduleId, version);
  const queue = readQueue().filter((item) => installKey(item.moduleId, item.version) !== key);
  queue.push({
    moduleId,
    version,
    includeSourceAssets,
    queuedAt: new Date().toISOString(),
  });
  writeQueue(queue);
}

export function dequeuePendingModuleInstall(moduleId: string, version: string): void {
  const key = installKey(moduleId, version);
  writeQueue(readQueue().filter((item) => installKey(item.moduleId, item.version) !== key));
}

export function listPendingModuleInstalls(): readonly PendingModuleInstall[] {
  return readQueue();
}

function findCatalogModule(
  catalog: ContentModuleCatalog,
  pending: PendingModuleInstall,
): ContentModuleCatalogEntry | undefined {
  return catalog.modules.find(
    (module) => module.id === pending.moduleId && module.version === pending.version,
  );
}

export function recoverPendingModuleInstalls(
  runtime: BrowserContentModuleRuntime,
  catalog: ContentModuleCatalog,
  installedModuleIds: ReadonlySet<string>,
): void {
  for (const pending of listPendingModuleInstalls()) {
    if (installedModuleIds.has(pending.moduleId)) {
      dequeuePendingModuleInstall(pending.moduleId, pending.version);
      continue;
    }
    const module = findCatalogModule(catalog, pending);
    if (module?.releaseState !== 'published') continue;
    const activeTask = runtime
      .listTasks()
      .find(
        (task) =>
          task.moduleId === pending.moduleId &&
          task.version === pending.version &&
          !['completed', 'failed', 'cancelled'].includes(task.state),
      );
    if (activeTask) continue;
    runtime.install(module);
  }
}
