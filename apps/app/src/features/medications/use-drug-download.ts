import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';
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

const FINISHED_TASK_STATES = new Set<ContentModuleDownloadTask['state']>([
  'completed',
  'failed',
  'cancelled',
]);

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
  const [runtime, setRuntime] = createSignal<BrowserContentModuleRuntime>();
  const [failed, setFailed] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const [starting, setStarting] = createSignal(0);
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
    const tasks = current.listTasks();
    const progress = moduleGroupDownloadProgress(modules, installedIds, tasks);
    return {
      current,
      installedIds,
      modules,
      plan,
      progress,
      tasks,
      totalBytes: totalDownloadBytes(modules),
    };
  });

  const state = createMemo<DrugDownloadState | undefined>(() => {
    const value = internal();
    if (!value) return undefined;
    const { modules, plan, progress, totalBytes, installedIds, tasks } = value;
    return { modules, plan, progress, totalBytes, installedIds, tasks };
  });

  const active = () => starting() > 0 || (internal()?.progress.activeTaskCount ?? 0) > 0;

  const start = async (modules?: readonly ContentModuleCatalogEntry[]): Promise<void> => {
    const value = internal();
    if (!value) return;
    // The whole set waits for a quiet queue; a single package may join a running download.
    if (!modules && active()) return;
    const queued = new Set(
      value.tasks
        .filter((task) => !FINISHED_TASK_STATES.has(task.state))
        .map((task) => task.moduleId),
    );
    const wanted = (modules ?? value.plan.pending).filter((module) => !queued.has(module.id));
    if (wanted.length === 0) return;
    setProblem(false);
    setStarting((count) => count + 1);
    try {
      const result = await installPublishedCategoryModules(
        value.current,
        wanted,
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
      setStarting((count) => count - 1);
    }
  };

  return { state, failed, problem, active, start };
}
