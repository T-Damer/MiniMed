import type { ContentModuleCatalogEntry } from '@localmed/contracts';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';

export interface CategoryInstallResult {
  readonly changed: boolean;
  readonly errorMessage: string | null;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export async function installPublishedCategoryModules(
  runtime: BrowserContentModuleRuntime,
  modules: readonly ContentModuleCatalogEntry[],
  installedModuleIds: ReadonlySet<string>,
): Promise<CategoryInstallResult> {
  const pending = modules.filter(
    (module) => module.releaseState === 'published' && !installedModuleIds.has(module.id),
  );
  if (pending.length === 0) {
    return { changed: false, errorMessage: null };
  }

  const tasks = [];
  for (const module of pending) {
    tasks.push(runtime.install(module));
    await yieldToBrowser();
  }
  const completions = tasks.map((task) => runtime.wait(task.id));
  const results = await Promise.all(completions);
  const changed = results.some((task) => task.state === 'completed');
  const failed = results.find((task) => task.state === 'failed');
  return {
    changed,
    errorMessage: failed?.errorMessage ?? null,
  };
}

export async function removeInstalledCategoryModules(
  runtime: BrowserContentModuleRuntime,
  modules: readonly ContentModuleCatalogEntry[],
  installedModuleIds: ReadonlySet<string>,
): Promise<void> {
  const installed = modules.filter((module) => installedModuleIds.has(module.id));
  await Promise.all(installed.map((module) => runtime.remove(module.id)));
}
