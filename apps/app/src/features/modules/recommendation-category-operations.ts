import type { ContentModuleCatalogEntry } from '@localmed/contracts';

import { getDownloadQueue } from '@/features/downloads/download-service';
import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { batchPendingModuleInstalls } from '@/features/modules/pending-module-installs';

export interface CategoryInstallResult {
  readonly changed: boolean;
  readonly errorMessage: string | null;
}

const ENQUEUE_CHUNK_SIZE = 32;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export async function installPublishedCategoryModules(
  runtime: BrowserContentModuleRuntime,
  modules: readonly ContentModuleCatalogEntry[],
  installedModuleIds: ReadonlySet<string>,
): Promise<CategoryInstallResult> {
  const pending = modules.filter(
    (module) => isModuleReleased(module) && !installedModuleIds.has(module.id),
  );
  if (pending.length === 0) {
    return { changed: false, errorMessage: null };
  }

  const tasks: ReturnType<BrowserContentModuleRuntime['install']>[] = [];
  let schedulingError: string | null = null;
  const queue = getDownloadQueue();
  for (let start = 0; start < pending.length; start += ENQUEUE_CHUNK_SIZE) {
    const chunk = pending.slice(start, start + ENQUEUE_CHUNK_SIZE);
    queue.batch(() =>
      batchPendingModuleInstalls(() => {
        for (const module of chunk) {
          try {
            tasks.push(runtime.install(module));
          } catch (cause) {
            schedulingError ??=
              cause instanceof Error ? cause.message : 'Не удалось начать скачивание набора.';
          }
        }
      }),
    );
    if (start + ENQUEUE_CHUNK_SIZE < pending.length) {
      await yieldToBrowser();
      // If the doctor tapped «Отменить все» mid-enqueue, stop adding the rest of the catalog.
      if (
        tasks.length > 0 &&
        tasks.every((task) => {
          const current = queue.get(`module:${task.moduleId}@${task.version}`);
          return current?.state === 'cancelled' || current?.state === 'cancelling';
        })
      ) {
        break;
      }
    }
  }
  const completions = tasks.map((task) => runtime.wait(task.id));
  const results = await Promise.all(completions);
  const changed = results.some((task) => task.state === 'completed');
  const failed = results.find((task) => task.state === 'failed');
  return {
    changed,
    errorMessage: schedulingError ?? failed?.errorMessage ?? null,
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
