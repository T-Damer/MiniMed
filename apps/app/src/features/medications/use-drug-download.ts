import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { type Accessor, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { toast } from 'solid-sonner';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import {
  contentModuleNeedsInstall,
  isModuleReleased,
  mergePreinstalledModules,
} from '@/features/modules/local-packaged-modules';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import {
  moduleGroupDownloadProgress,
  type RecommendationCategoryDownloadProgress,
} from '@/features/modules/recommendation-categories';
import { installPublishedCategoryModules } from '@/features/modules/recommendation-category-operations';
import {
  type DrugDownloadPlan,
  drugDownloadPlan,
  drugModules,
  totalDownloadBytes,
} from '@/features/onboarding/onboarding-downloads';

export interface DrugDownloadState {
  readonly modules: readonly ContentModuleCatalogEntry[];
  readonly plan: DrugDownloadPlan;
  /** Bytes of every released «Препараты» package, installed or not. */
  readonly totalBytes: number | null;
  readonly progress: RecommendationCategoryDownloadProgress;
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
  readonly start: () => Promise<void>;
}

/**
 * The «Препараты» packages queued through the module runtime the section picker uses. The full
 * catalog (~10 MB) loads here on mount, never at start-up. Shared by the tour and the catalog page.
 */
export function useDrugDownload(onContentChanged: () => Promise<void>): DrugDownload {
  const [runtime, setRuntime] = createSignal<BrowserContentModuleRuntime>();
  const [failed, setFailed] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const [starting, setStarting] = createSignal(false);
  const [problem, setProblem] = createSignal(false);

  onMount(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    onCleanup(() => {
      disposed = true;
      unsubscribe?.();
    });
    loadModuleCatalog()
      .then((catalog) => {
        if (disposed) return;
        const current = getContentModuleRuntime(catalog);
        setRuntime(current);
        unsubscribe = current.subscribe(() => setRevision((value) => value + 1));
      })
      .catch((cause: unknown) => {
        console.warn('Каталог пакетов не загрузился.', cause);
        if (!disposed) setFailed(true);
      });
  });

  const internal = createMemo(() => {
    revision();
    const current = runtime();
    if (!current) return undefined;
    const catalog = current.getCatalog();
    const modules = drugModules(catalog, isModuleReleased);
    const installedById = new Map(
      mergePreinstalledModules(catalog, current.listInstalled()).map((module) => [
        module.moduleId,
        module,
      ]),
    );
    const isInstalled = (module: ContentModuleCatalogEntry): boolean =>
      !contentModuleNeedsInstall(module, installedById.get(module.id));
    const plan = drugDownloadPlan(modules, isInstalled);
    const installedIds = new Set(modules.filter(isInstalled).map((module) => module.id));
    const progress = moduleGroupDownloadProgress(modules, installedIds, current.listTasks());
    return {
      current,
      installedIds,
      modules,
      plan,
      progress,
      totalBytes: totalDownloadBytes(modules),
    };
  });

  const state = createMemo<DrugDownloadState | undefined>(() => {
    const value = internal();
    if (!value) return undefined;
    const { modules, plan, progress, totalBytes } = value;
    return { modules, plan, progress, totalBytes };
  });

  const active = () => starting() || (internal()?.progress.activeTaskCount ?? 0) > 0;

  const start = async (): Promise<void> => {
    const value = internal();
    if (!value || active()) return;
    setProblem(false);
    setStarting(true);
    try {
      const result = await installPublishedCategoryModules(
        value.current,
        value.plan.pending,
        value.installedIds,
      );
      if (result.errorMessage) {
        setProblem(true);
        toast.error(result.errorMessage);
      }
      if (result.changed) await onContentChanged();
    } catch (cause) {
      setProblem(true);
      toast.error(cause instanceof Error ? cause.message : 'Не удалось скачать препараты.');
    } finally {
      setStarting(false);
    }
  };

  return { state, failed, problem, active, start };
}
