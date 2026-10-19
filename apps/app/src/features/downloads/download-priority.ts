import { getDownloadQueue } from '@/features/downloads/download-service';
import { queueTaskFor } from '@/features/downloads/module-download-view';

/** Queue ids of these modules' downloads that «Скачать сейчас» can still move ahead. */
function prioritizableModuleJobs(moduleIds: readonly string[]): readonly string[] {
  const queue = getDownloadQueue();
  const tasks = queue.list();
  return moduleIds.flatMap((moduleId) => {
    const task = queueTaskFor(moduleId, tasks);
    return task && queue.canPrioritize(task.id) ? [task.id] : [];
  });
}

export function canPrioritizeModules(moduleIds: readonly string[]): boolean {
  return prioritizableModuleJobs(moduleIds).length > 0;
}

/**
 * «Скачать сейчас»: these modules download before everything else; the other downloads stop,
 * keep what they received and continue in their previous order once these are done.
 */
export function prioritizeModuleDownloads(moduleIds: readonly string[]): void {
  getDownloadQueue().prioritize(prioritizableModuleJobs(moduleIds));
}
