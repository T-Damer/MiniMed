import type { ContentModuleDownloadTask } from '@localmed/contracts';

const TERMINAL_STATES = new Set<ContentModuleDownloadTask['state']>(['completed', 'cancelled']);
const ACTIVE_DOWNLOAD_STATES = new Set<ContentModuleDownloadTask['state']>([
  'queued',
  'downloading',
  'verifying',
  'installing',
]);

export const CONTENT_DOWNLOAD_INDETERMINATE_PROGRESS = 0.08;

export function latestVisibleDownloadTasks(
  tasks: readonly ContentModuleDownloadTask[],
): readonly ContentModuleDownloadTask[] {
  const seen = new Set<string>();
  const latest: ContentModuleDownloadTask[] = [];
  for (const task of [...tasks].reverse()) {
    if (TERMINAL_STATES.has(task.state)) continue;
    const key = `${task.moduleId}@${task.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(task);
  }
  return latest.reverse();
}

export function activeContentDownloadTasks(
  tasks: readonly ContentModuleDownloadTask[],
): readonly ContentModuleDownloadTask[] {
  return latestVisibleDownloadTasks(tasks).filter((task) => ACTIVE_DOWNLOAD_STATES.has(task.state));
}

export function hasActiveContentDownloads(tasks: readonly ContentModuleDownloadTask[]): boolean {
  return activeContentDownloadTasks(tasks).length > 0;
}

export function aggregateDownloadProgress(
  tasks: readonly ContentModuleDownloadTask[],
): number | null {
  let downloaded = 0;
  let total = 0;
  for (const task of tasks) {
    if (!task.totalBytes || task.totalBytes <= 0) continue;
    downloaded += task.downloadedBytes;
    total += task.totalBytes;
  }
  if (total <= 0) return null;
  return Math.max(0, Math.min(1, downloaded / total));
}

export function downloadProgressFraction(tasks: readonly ContentModuleDownloadTask[]): number {
  return aggregateDownloadProgress(tasks) ?? CONTENT_DOWNLOAD_INDETERMINATE_PROGRESS;
}

export function downloadNavPieBackground(progress: number, failed: boolean): string {
  const clamped = Math.max(0, Math.min(1, progress));
  const degrees = clamped * 360;
  const fill = failed ? 'var(--theme-danger, #b4574d)' : '#e8c654';
  return `conic-gradient(${fill} ${degrees}deg, rgb(255 255 255 / 22%) ${degrees}deg)`;
}
