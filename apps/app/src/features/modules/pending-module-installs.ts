import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';

const STORAGE_KEY = 'minimed.pending-module-installs.v1';
const INSTALLED_MODULES_STORAGE_KEY = 'localmed.installed-modules.v1';

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

function isInstalledVersionActive(moduleId: string, version: string): boolean {
  try {
    const raw = window.localStorage.getItem(INSTALLED_MODULES_STORAGE_KEY);
    if (!raw) return false;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('entries' in value)) return false;
    const entries = (value as { readonly entries?: unknown }).entries;
    if (!Array.isArray(entries)) return false;
    return entries.some((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const candidate = entry as {
        readonly moduleId?: unknown;
        readonly active?: { readonly version?: unknown };
      };
      return candidate.moduleId === moduleId && candidate.active?.version === version;
    });
  } catch {
    return false;
  }
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
  // The installer reports terminal states for success, failure and cancellation through the same
  // callback. Remove the durable queue entry only after the registry proves that this exact version
  // was activated. Failed/interrupted work then survives a reload and resumes from cached bytes.
  if (!isInstalledVersionActive(moduleId, version)) return;
  const key = installKey(moduleId, version);
  writeQueue(readQueue().filter((item) => installKey(item.moduleId, item.version) !== key));
}

export function discardPendingModuleInstall(moduleId: string, version: string): void {
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
    if (
      installedModuleIds.has(pending.moduleId) &&
      isInstalledVersionActive(pending.moduleId, pending.version)
    ) {
      dequeuePendingModuleInstall(pending.moduleId, pending.version);
      continue;
    }
    const module = findCatalogModule(catalog, pending);
    if (!module || (module.releaseState !== 'published' && module.releaseState !== 'preview')) continue;
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
