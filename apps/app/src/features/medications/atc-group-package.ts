import type { ContentModuleCatalogEntry } from '@localmed/contracts';

import type { DrugDownloadState } from '@/features/medications/use-drug-download';
import { formatModuleBytes } from '@/features/modules/module-display';
import {
  moduleGroupDownloadProgress,
  moduleGroupTaskState,
} from '@/features/modules/recommendation-categories';

/**
 * The download state of the ЕСКЛП package behind one level-1 ATC group, read from the shared
 * «Препараты» download state (the same module runtime and queue as the catalog's own button).
 */
export type AtcGroupPackageStatus =
  /** The package list has not loaded (yet, or at all). */
  | 'unknown'
  /** The release has no package for this group. */
  | 'unavailable'
  | 'installed'
  | 'missing'
  | 'queued'
  | 'downloading'
  /** Held by «Пауза»; the bytes received are kept. */
  | 'paused';

export interface AtcGroupPackage {
  readonly status: AtcGroupPackageStatus;
  readonly module: ContentModuleCatalogEntry | undefined;
  /** Declared download size; null when the catalog does not give one. */
  readonly bytes: number | null;
  /** 0-1 while downloading, null while the size is unknown. */
  readonly progress: number | null;
}

export function atcGroupPackage(
  moduleId: string,
  state: DrugDownloadState | undefined,
): AtcGroupPackage {
  if (!state) return { status: 'unknown', module: undefined, bytes: null, progress: null };
  const module = state.modules.find((candidate) => candidate.id === moduleId);
  if (!module) return { status: 'unavailable', module: undefined, bytes: null, progress: null };
  const bytes = module.sizes.downloadBytes;
  if (state.installedIds.has(moduleId)) return { status: 'installed', module, bytes, progress: 1 };
  const task = moduleGroupTaskState([module], state.tasks, state.paused);
  if (task === null) return { status: 'missing', module, bytes, progress: null };
  const progress = moduleGroupDownloadProgress([module], state.installedIds, state.tasks);
  return {
    status: task === 'paused' ? 'paused' : task === 'queued' ? 'queued' : 'downloading',
    module,
    bytes,
    progress: progress.byteProgress,
  };
}

/** «Скачать · 9,8 МБ», «В очереди», «Скачиваем · 40 %». */
export function atcGroupActionLabel(item: AtcGroupPackage, failed: boolean): string {
  switch (item.status) {
    case 'queued':
      return 'В очереди';
    case 'paused':
      return 'На паузе';
    case 'downloading':
      return item.progress === null
        ? 'Скачиваем…'
        : `Скачиваем · ${String(Math.floor(item.progress * 100))} %`;
    case 'missing': {
      const size = item.bytes === null ? '' : ` · ${formatModuleBytes(item.bytes)}`;
      return `${failed ? 'Повторить' : 'Скачать'}${size}`;
    }
    default:
      return '';
  }
}

/**
 * What a group row says about its package: its size while it is missing, the queue state while it
 * is coming, and the substance counts only once the package is installed (a count read from a
 * package that is not there would describe a part of the group as if it were all of it).
 */
export function atcGroupRowMeta(
  item: AtcGroupPackage,
  counts: string | null,
  loading: boolean,
): string {
  switch (item.status) {
    case 'installed':
      return counts ?? (loading ? 'Читаем базу…' : '');
    case 'missing':
      return item.bytes === null ? 'не скачано' : `не скачано · ${formatModuleBytes(item.bytes)}`;
    case 'queued':
      return 'в очереди';
    case 'paused':
      return 'на паузе';
    case 'downloading':
      return item.progress === null
        ? 'скачивается…'
        : `скачивается · ${String(Math.floor(item.progress * 100))} %`;
    case 'unavailable':
      return 'недоступно';
    default:
      return loading ? 'Читаем базу…' : '';
  }
}

/** «Скачать всё · 286 МБ», «Скачиваем · 40 %»; empty when there is nothing left to fetch. */
export function atcDownloadAllLabel(
  state: DrugDownloadState | undefined,
  active: boolean,
  failed: boolean,
): string {
  if (!state || state.modules.length === 0 || state.plan.complete) return '';
  if (active && state.paused) return 'На паузе';
  if (active) {
    const fraction = state.progress.byteProgress;
    return fraction === null ? 'Скачиваем…' : `Скачиваем · ${String(Math.floor(fraction * 100))} %`;
  }
  const size = state.plan.bytes === null ? '' : ` · ${formatModuleBytes(state.plan.bytes)}`;
  return `${failed ? 'Повторить' : 'Скачать всё'}${size}`;
}
