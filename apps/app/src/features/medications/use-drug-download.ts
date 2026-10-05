import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';
import { type Accessor, createMemo } from 'solid-js';

import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import {
  moduleGroupDownloadProgress,
  type RecommendationCategoryDownloadProgress,
} from '@/features/modules/recommendation-categories';
import {
  type DrugDownloadPlan,
  drugModules,
  moduleDownloadPlan,
  totalDownloadBytes,
} from '@/features/onboarding/onboarding-downloads';
import { useModuleInstaller } from '@/features/sections/use-module-installer';

export interface DrugDownloadState {
  readonly modules: readonly ContentModuleCatalogEntry[];
  readonly plan: DrugDownloadPlan;
  /** Bytes of every released «Препараты» package, installed or not. */
  readonly totalBytes: number | null;
  readonly progress: RecommendationCategoryDownloadProgress;
  /** Ids of the released «Препараты» packages that are installed. */
  readonly installedIds: ReadonlySet<string>;
  /** Download tasks of the module runtime, finished ones included. */
  readonly tasks: readonly ContentModuleDownloadTask[];
}

export interface DrugDownload {
  /** Undefined until the release catalog and the module runtime are loaded. */
  readonly state: Accessor<DrugDownloadState | undefined>;
  /** The catalog could not be loaded. */
  readonly failed: Accessor<boolean>;
  /** The last start ended with an error. */
  readonly problem: Accessor<boolean>;
  /** Packages are being queued or downloaded. */
  readonly active: Accessor<boolean>;
  /** Queues the given packages (default: every package still missing). */
  readonly start: (modules?: readonly ContentModuleCatalogEntry[]) => Promise<void>;
}

/**
 * The «Препараты» packages queued through the module runtime the section picker uses. The full
 * catalog (~10 MB) loads here on mount, never at start-up. Shared by the tour and the catalog page.
 */
export function useDrugDownload(onContentChanged: () => Promise<void>): DrugDownload {
  const installer = useModuleInstaller(onContentChanged, 'Не удалось скачать препараты.');

  const state = createMemo<DrugDownloadState | undefined>(() => {
    const snapshot = installer.snapshot();
    if (!snapshot) return undefined;
    const modules = drugModules(snapshot.catalog, isModuleReleased);
    const plan = moduleDownloadPlan(modules, snapshot.isInstalled);
    const installedIds = new Set(modules.filter(snapshot.isInstalled).map((module) => module.id));
    return {
      modules,
      plan,
      progress: moduleGroupDownloadProgress(modules, installedIds, snapshot.tasks),
      totalBytes: totalDownloadBytes(modules),
      installedIds,
      tasks: snapshot.tasks,
    };
  });

  const active = () => installer.starting() || (state()?.progress.activeTaskCount ?? 0) > 0;

  const start = async (modules?: readonly ContentModuleCatalogEntry[]): Promise<void> => {
    const value = state();
    if (!value) return;
    // The whole set waits for a quiet queue; a single package may join a running download.
    if (!modules && active()) return;
    await installer.start(modules ?? value.plan.pending);
  };

  return { state, failed: installer.failed, problem: installer.problem, active, start };
}
