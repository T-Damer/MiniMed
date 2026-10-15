import type { ContentModuleDownloadTask } from '@localmed/contracts';

import { type DownloadTask, downloadTaskFraction } from '@/features/downloads/download-queue';

/**
 * What every download offer says about one module, derived from a single place: the shared
 * download queue (persisted, available before the release catalog is read) and, once the module
 * runtime is loaded, its own tasks. An offer never decides this from its own component state, so a
 * download that started elsewhere, or before the screen was reopened, shows at once.
 */
export type ModuleDownloadPhase =
  /** Nothing is happening: offer the download. */
  | 'idle'
  /** Waiting for a free transfer slot or for the network. */
  | 'queued'
  /** Started by this screen, no byte received yet. */
  | 'connecting'
  /** Cut by a reload (or kept as a durable intent) and being picked up again by the runtime. */
  | 'resuming'
  | 'downloading'
  /** Held by «Пауза»: the bytes received are kept and «Продолжить» resumes from them. */
  | 'paused'
  /** After the last byte: checksum, decoding, commit. */
  | 'installing'
  /** A download that ended with an error; offer a retry. */
  | 'failed'
  | 'installed';

export interface ModuleDownloadView {
  readonly phase: ModuleDownloadPhase;
  /** 0-1 while bytes are moving and the total is known; null otherwise. */
  readonly fraction: number | null;
  /** Whole percent for a label, 1-99 once bytes arrived; null when there is no number to show. */
  readonly percent: number | null;
}

export const IDLE_MODULE_DOWNLOAD: ModuleDownloadView = {
  phase: 'idle',
  fraction: null,
  percent: null,
};

export interface ModuleDownloadInput {
  readonly moduleId: string;
  readonly installed: boolean;
  /** Tasks of the shared download queue (all kinds). */
  readonly queueTasks: readonly DownloadTask[];
  /** Tasks of the module runtime; empty until the runtime is loaded. */
  readonly runtimeTasks: readonly ContentModuleDownloadTask[];
  /** Module ids of durable «install this» intents that survived a reload and are being resumed. */
  readonly pendingModuleIds: ReadonlySet<string>;
  /** A start of this module is being queued by the offer itself. */
  readonly starting: boolean;
}

const RUNTIME_FINISHED = new Set<ContentModuleDownloadTask['state']>([
  'completed',
  'failed',
  'cancelled',
]);

function percentOf(fraction: number | null, receivedBytes: boolean): number | null {
  if (fraction === null) return null;
  const whole = Math.floor(Math.max(0, Math.min(1, fraction)) * 100);
  return Math.min(99, receivedBytes ? Math.max(1, whole) : whole);
}

function fromRuntime(task: ContentModuleDownloadTask): ModuleDownloadView {
  switch (task.state) {
    case 'queued':
      return { phase: 'queued', fraction: null, percent: null };
    case 'verifying':
    case 'installing':
      return { phase: 'installing', fraction: null, percent: null };
    case 'downloading': {
      const total = task.totalBytes ?? 0;
      if (total > 0 && task.downloadedBytes >= total) {
        return { phase: 'installing', fraction: null, percent: null };
      }
      if (task.downloadedBytes <= 0) return { phase: 'connecting', fraction: null, percent: null };
      const fraction = total > 0 ? Math.min(1, task.downloadedBytes / total) : null;
      return { phase: 'downloading', fraction, percent: percentOf(fraction, true) };
    }
    default:
      return IDLE_MODULE_DOWNLOAD;
  }
}

function fromQueue(task: DownloadTask): ModuleDownloadView {
  switch (task.state) {
    case 'queued':
    case 'retrying':
      return { phase: 'queued', fraction: null, percent: null };
    case 'verifying':
    case 'installing':
      return { phase: 'installing', fraction: null, percent: null };
    case 'downloading': {
      if (task.downloadedBytes <= 0) return { phase: 'connecting', fraction: null, percent: null };
      const fraction = downloadTaskFraction(task);
      return { phase: 'downloading', fraction, percent: percentOf(fraction, true) };
    }
    case 'paused':
      return { phase: 'paused', fraction: downloadTaskFraction(task), percent: null };
    case 'interrupted':
      // A reload cut the transfer; the module runtime resumes it as soon as it is loaded.
      return { phase: 'resuming', fraction: null, percent: null };
    case 'failed':
      return { phase: 'failed', fraction: null, percent: null };
    default:
      return IDLE_MODULE_DOWNLOAD;
  }
}

/** Queue tasks of the module, newest version last (ids are `module:<id>@<version>`). */
function queueTaskFor(moduleId: string, tasks: readonly DownloadTask[]): DownloadTask | undefined {
  const prefix = `module:${moduleId}@`;
  return tasks.findLast((task) => task.kind === 'module' && task.id.startsWith(prefix));
}

export function moduleDownloadView(input: ModuleDownloadInput): ModuleDownloadView {
  if (input.installed) return { phase: 'installed', fraction: 1, percent: null };

  // «Пауза» wins over what the runtime still reports for a transfer it is waiting on.
  const queueTask = queueTaskFor(input.moduleId, input.queueTasks);
  if (queueTask?.state === 'paused') return fromQueue(queueTask);

  const runtimeTask = input.runtimeTasks.findLast(
    (task) => task.moduleId === input.moduleId && !RUNTIME_FINISHED.has(task.state),
  );
  if (runtimeTask) return fromRuntime(runtimeTask);

  if (queueTask) {
    const view = fromQueue(queueTask);
    if (view.phase !== 'idle') {
      // A failed record is history once the person (or the runtime) has started the module again.
      if (view.phase === 'failed' && input.starting) {
        return { phase: 'connecting', fraction: null, percent: null };
      }
      if (view.phase === 'failed' && input.pendingModuleIds.has(input.moduleId)) {
        return { phase: 'resuming', fraction: null, percent: null };
      }
      return view;
    }
  }
  if (input.starting) return { phase: 'connecting', fraction: null, percent: null };
  if (input.pendingModuleIds.has(input.moduleId)) {
    return { phase: 'resuming', fraction: null, percent: null };
  }
  return IDLE_MODULE_DOWNLOAD;
}

/** A transfer is in flight or waiting: the offer must not start another one. */
export function isModuleDownloadBusy(view: ModuleDownloadView): boolean {
  return (
    view.phase === 'queued' ||
    view.phase === 'connecting' ||
    view.phase === 'resuming' ||
    view.phase === 'downloading' ||
    view.phase === 'paused' ||
    view.phase === 'installing'
  );
}

/** «В очереди», «Подключаемся…», «Продолжаем…», «Скачиваем · 30 %», «На паузе», «Устанавливаем…»; empty otherwise. */
export function moduleDownloadStatusLabel(view: ModuleDownloadView): string {
  switch (view.phase) {
    case 'queued':
      return 'В очереди';
    case 'connecting':
      return 'Подключаемся…';
    case 'resuming':
      return 'Продолжаем…';
    case 'downloading':
      return view.percent === null ? 'Скачиваем…' : `Скачиваем · ${String(view.percent)} %`;
    case 'paused':
      return 'На паузе';
    case 'installing':
      return 'Устанавливаем…';
    default:
      return '';
  }
}
