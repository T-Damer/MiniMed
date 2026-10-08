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
    const key = `${task.moduleId}@${task.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (TERMINAL_STATES.has(task.state)) continue;
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

/**
 * What a download offer says about its tasks. `connecting` is a started download that has not
 * received a byte yet, `installing` is everything after the last byte (checksum, decoding, commit).
 */
export type ContentDownloadPhase = 'queued' | 'connecting' | 'downloading' | 'installing';

function taskPhase(task: ContentModuleDownloadTask): ContentDownloadPhase | null {
  switch (task.state) {
    case 'queued':
      return 'queued';
    case 'verifying':
    case 'installing':
      return 'installing';
    case 'downloading':
      if (task.totalBytes && task.totalBytes > 0 && task.downloadedBytes >= task.totalBytes) {
        return 'installing';
      }
      return task.downloadedBytes > 0 ? 'downloading' : 'connecting';
    default:
      return null;
  }
}

const PHASE_PRIORITY: readonly ContentDownloadPhase[] = [
  'downloading',
  'connecting',
  'installing',
  'queued',
];

/** The phase a group of tasks shows: bytes still moving win over a task that waits or installs. */
export function contentDownloadPhase(
  tasks: readonly ContentModuleDownloadTask[],
): ContentDownloadPhase | null {
  const phases = new Set(tasks.map(taskPhase));
  return PHASE_PRIORITY.find((phase) => phases.has(phase)) ?? null;
}

/** A whole percent for a download in flight: «0%» only before the first byte, never «100%» before the end. */
export function downloadPercent(fraction: number, receivedBytes: boolean): number {
  const percent = Math.floor(Math.max(0, Math.min(1, fraction)) * 100);
  return Math.min(99, receivedBytes ? Math.max(1, percent) : percent);
}

export function downloadNavPieBackground(progress: number, failed: boolean): string {
  const clamped = Math.max(0, Math.min(1, progress));
  const degrees = clamped * 360;
  const fill = failed ? 'var(--theme-danger, #b4574d)' : '#e8c654';
  return `conic-gradient(${fill} ${degrees}deg, rgb(255 255 255 / 22%) ${degrees}deg)`;
}
