import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';

import { ANDROID_CORE_DOWNLOAD } from '@/composition/core-download';
import { formatModuleBytes } from '@/features/modules/module-display';
import { totalDownloadBytes } from '@/features/onboarding/onboarding-downloads';

/**
 * «Скачать всё»: every content module the release has, plus the meaning-search model, minus the
 * image packs, which are offered on their own because they are large and only illustrative for
 * the reading flow. Pure: the catalog and the release/installed tests come in, a plan goes out.
 */

/** A pack whose download is almost entirely source assets (photographs), not searchable text. */
const IMAGE_PACK_SHARE = 0.9;

export function isImagePackModule(
  module: Pick<ContentModuleCatalogEntry, 'artifacts' | 'sizes'>,
): boolean {
  if (!module.artifacts.some((artifact) => artifact.kind === 'source-assets')) return false;
  const total = module.sizes.downloadBytes ?? 0;
  const assets = module.sizes.sourceAssetsDownloadBytes ?? 0;
  return total > 0 && assets / total >= IMAGE_PACK_SHARE;
}

export interface FullDownloadPlan {
  /** Released modules to fetch, image packs and the bundled core excluded. */
  readonly modules: readonly ContentModuleCatalogEntry[];
  /** The part of {@link modules} not installed yet and not given up on (see {@link failed}). */
  readonly pending: readonly ContentModuleCatalogEntry[];
  /**
   * Modules whose download ended in an error and was not repeated: they are listed with their own
   * «Повторить ошибки», and a module that keeps failing must not keep «Скачать всё» on offer forever.
   */
  readonly failed: readonly ContentModuleCatalogEntry[];
  /** Declared bytes of {@link pending}; null when some module has no declared size. */
  readonly moduleBytes: number | null;
  /** Declared bytes of the optional image packs, offered separately. */
  readonly imagePackBytes: number;
  /** The meaning-search model, 0 once it is installed. */
  readonly modelBytes: number;
  /** The main database, 0 once it is installed. */
  readonly coreBytes: number;
  /** Everything «Скачать всё» fetches; null when some size is unknown. */
  readonly totalBytes: number | null;
}

export interface FullDownloadInput {
  readonly catalog: ContentModuleCatalog;
  readonly released: (module: ContentModuleCatalogEntry) => boolean;
  readonly installed: (module: ContentModuleCatalogEntry) => boolean;
  /** The module's latest download ended in an error (default: none). */
  readonly failed?: (module: ContentModuleCatalogEntry) => boolean;
  readonly coreInstalled: boolean;
  readonly modelInstalled: boolean;
  readonly modelBytes: number;
}

export function fullDownloadPlan(input: FullDownloadInput): FullDownloadPlan {
  const modules = input.catalog.modules.filter(
    (module) => module.kind !== 'core' && input.released(module) && !isImagePackModule(module),
  );
  const missing = modules.filter((module) => !input.installed(module));
  const failed = missing.filter((module) => input.failed?.(module) === true);
  const pending = missing.filter((module) => input.failed?.(module) !== true);
  const moduleBytes = totalDownloadBytes(pending);
  const modelBytes = input.modelInstalled ? 0 : input.modelBytes;
  const coreBytes = input.coreInstalled ? 0 : ANDROID_CORE_DOWNLOAD.transferSizeBytes;
  return {
    modules,
    pending,
    failed,
    moduleBytes,
    imagePackBytes: input.catalog.modules
      .filter((module) => input.released(module) && isImagePackModule(module))
      .reduce((sum, module) => sum + (module.sizes.downloadBytes ?? 0), 0),
    modelBytes,
    coreBytes,
    totalBytes: moduleBytes === null ? null : moduleBytes + modelBytes + coreBytes,
  };
}

/** «Скачать всё · 1,5 ГБ», or the state of the offer while its size or its download is unknown. */
export function fullDownloadLabel(
  plan: FullDownloadPlan | undefined,
  active: boolean,
  /** The queue is held by «Пауза»: say so instead of «Скачиваем…». */
  paused = false,
): string {
  if (!plan) return 'Считаем размер…';
  if (active) return paused ? 'На паузе' : 'Скачиваем…';
  if (plan.pending.length === 0 && plan.modelBytes === 0 && plan.coreBytes === 0) {
    return plan.failed.length > 0 ? 'Есть ошибки загрузки' : 'Всё скачано';
  }
  return plan.totalBytes === null
    ? 'Скачать всё'
    : `Скачать всё · ${formatModuleBytes(plan.totalBytes)}`;
}
