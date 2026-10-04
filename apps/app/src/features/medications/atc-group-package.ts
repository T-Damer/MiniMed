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
  | 'downloading';

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
  const task = moduleGroupTaskState([module], state.tasks);
  if (task === null) return { status: 'missing', module, bytes, progress: null };
  const progress = moduleGroupDownloadProgress([module], state.installedIds, state.tasks);
  return {
    status: task === 'queued' ? 'queued' : 'downloading',
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
