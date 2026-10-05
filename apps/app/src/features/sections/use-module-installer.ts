import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
} from '@localmed/contracts';
import { type Accessor, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { toast } from 'solid-sonner';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import {
  contentModuleNeedsInstall,
  mergePreinstalledModules,
} from '@/features/modules/local-packaged-modules';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { installPublishedCategoryModules } from '@/features/modules/recommendation-category-operations';

const FINISHED_TASK_STATES = new Set<ContentModuleDownloadTask['state']>([
  'completed',
  'failed',
  'cancelled',
]);

/** The module runtime as a view: what is installed and what the download queue is doing. */
export interface ModuleInstallerSnapshot {
  readonly catalog: ContentModuleCatalog;
  /** Installed at the catalog's version and source set. */
  readonly isInstalled: (module: ContentModuleCatalogEntry) => boolean;
  /** Ids of the catalog modules that are installed. */
  readonly installedIds: ReadonlySet<string>;
  /** Download tasks of the module runtime, finished ones included. */
  readonly tasks: readonly ContentModuleDownloadTask[];
}

export interface ModuleInstaller {
  /** Undefined until the release catalog and the module runtime are loaded. */
  readonly snapshot: Accessor<ModuleInstallerSnapshot | undefined>;
  /** The catalog could not be loaded. */
  readonly failed: Accessor<boolean>;
  /** The last start ended with an error. */
  readonly problem: Accessor<boolean>;
  /** Packages are being queued by {@link ModuleInstaller.start}. */
  readonly starting: Accessor<boolean>;
  /** Queues the packages not yet installed or queued; resolves when they are all done. */
  readonly start: (modules: readonly ContentModuleCatalogEntry[]) => Promise<void>;
}

/**
 * Queues packages through the module runtime the knowledge base uses, so every download shows in
 * the shared queue. The full catalog (~10 MB) loads here on mount, never at start-up. Shared by the
 * drug download and the section download.
 */
export function useModuleInstaller(
  onContentChanged: () => Promise<void>,
  failureMessage = 'Не удалось скачать пакеты.',
): ModuleInstaller {
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

  const current = createMemo(() => {
    revision();
    const active = runtime();
    if (!active) return undefined;
    const catalog = active.getCatalog();
    const installedById = new Map(
      mergePreinstalledModules(catalog, active.listInstalled()).map((module) => [
        module.moduleId,
        module,
      ]),
    );
    const isInstalled = (module: ContentModuleCatalogEntry): boolean =>
      !contentModuleNeedsInstall(module, installedById.get(module.id));
    return {
      active,
      snapshot: {
        catalog,
        isInstalled,
        installedIds: new Set(
          catalog.modules.filter((module) => isInstalled(module)).map((module) => module.id),
        ),
        tasks: active.listTasks(),
      } satisfies ModuleInstallerSnapshot,
    };
  });

  const snapshot = createMemo(() => current()?.snapshot);

  const start = async (modules: readonly ContentModuleCatalogEntry[]): Promise<void> => {
    const value = current();
    if (!value) return;
    const queued = new Set(
      value.snapshot.tasks
        .filter((task) => !FINISHED_TASK_STATES.has(task.state))
        .map((task) => task.moduleId),
    );
    const wanted = modules.filter((module) => !queued.has(module.id));
    if (wanted.length === 0) return;
    setProblem(false);
    setStarting((count) => count + 1);
    try {
      const result = await installPublishedCategoryModules(
        value.active,
        wanted,
        value.snapshot.installedIds,
      );
      if (result.errorMessage) {
        setProblem(true);
        toast.error(result.errorMessage);
      }
      if (result.changed) await onContentChanged();
    } catch (cause) {
      setProblem(true);
      toast.error(cause instanceof Error ? cause.message : failureMessage);
    } finally {
      setStarting((count) => count - 1);
    }
  };

  return { snapshot, failed, problem, starting: () => starting() > 0, start };
}
