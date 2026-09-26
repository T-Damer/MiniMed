import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  activeContentDownloadTasks,
  latestVisibleDownloadTasks,
} from '@/features/modules/content-download-progress';
import {
  contentModuleNeedsInstall,
  mergePreinstalledModules,
} from '@/features/modules/local-packaged-modules';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { installPublishedCategoryModules } from '@/features/modules/recommendation-category-operations';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';

/** Placeholder until the lazily loaded release catalog and module runtime are available. */
const EMPTY_CATALOG: ContentModuleCatalog = {
  catalogVersion: '',
  channel: 'preview',
  publishedAt: '',
  categories: [],
  modules: [],
};

export function useSearchSectionDownloads(open: Accessor<boolean>, connect: () => Promise<void>) {
  const [runtime, setRuntime] = createSignal(peekContentModuleRuntime());
  const [catalog, setCatalog] = createSignal(runtime()?.getCatalog() ?? EMPTY_CATALOG);
  const [installed, setInstalled] = createSignal(runtime()?.listInstalled() ?? []);
  const [tasks, setTasks] = createSignal(runtime()?.listTasks() ?? []);
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal('');
  const [scheduled, setScheduled] = createSignal<ReadonlySet<string>>(new Set());
  const [preferenceRevision, setPreferenceRevision] = createSignal(0);
  let reconnect: Promise<void> | undefined;
  let reconnectPending = false;
  const refresh = (): void => {
    const current = runtime();
    if (!current) return;
    batch(() => {
      setCatalog(current.getCatalog());
      setInstalled(current.listInstalled());
      setTasks(current.listTasks());
    });
  };
  const reconnectContent = (): Promise<void> => {
    reconnectPending = true;
    if (reconnect) return reconnect;
    reconnect = (async () => {
      do {
        reconnectPending = false;
        await connect();
      } while (reconnectPending);
    })().finally(() => {
      reconnect = undefined;
    });
    return reconnect;
  };
  const reportError = (cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : 'Не удалось проверить локальные пакеты.');
  };
  /** Startup loads the catalog on idle; a menu or download request needs it right away. */
  const ensureRuntime = (): void => {
    if (runtime()) return;
    void loadModuleCatalog().then(getContentModuleRuntime).catch(reportError);
  };
  onMount(() => {
    let disposed = false;
    let unsubscribeRuntime: (() => void) | undefined;
    onCleanup(() => {
      disposed = true;
      unsubscribeRuntime?.();
    });
    onCleanup(subscribeAppPreferences(() => setPreferenceRevision((value) => value + 1)));
    window.addEventListener(CONTENT_CHANGED_EVENT, refresh);
    onCleanup(() => window.removeEventListener(CONTENT_CHANGED_EVENT, refresh));
    onCleanup(
      subscribeContentModuleRuntime((current) => {
        if (disposed) return;
        unsubscribeRuntime?.();
        setReady(false);
        setRuntime(current);
        unsubscribeRuntime = current.subscribe(refresh);
        refresh();
        void current
          .whenLocalPackagedModulesReady()
          .then(() => {
            if (disposed || runtime() !== current) return;
            batch(() => {
              refresh();
              setReady(true);
            });
          })
          .catch(reportError);
      }),
    );
  });
  createEffect(() => {
    if (open()) refresh();
  });
  const installedById = createMemo(
    () =>
      new Map(
        mergePreinstalledModules(catalog(), installed()).map((module) => [module.moduleId, module]),
      ),
  );
  const visibleTasks = createMemo(() => latestVisibleDownloadTasks(tasks()));
  const activeIds = createMemo(
    () =>
      new Set([
        ...scheduled(),
        ...activeContentDownloadTasks(tasks()).map((task) => task.moduleId),
      ]),
  );
  const installedIds = (modules: readonly ContentModuleCatalogEntry[]): ReadonlySet<string> =>
    new Set(
      modules
        .filter((module) => !contentModuleNeedsInstall(module, installedById().get(module.id)))
        .map((module) => module.id),
    );
  const install = async (modules: readonly ContentModuleCatalogEntry[]): Promise<void> => {
    const complete = installedIds(modules);
    const pending = modules.filter(
      (module) => !complete.has(module.id) && !activeIds().has(module.id),
    );
    // Offered modules come from catalog(), which is empty until a runtime exists.
    const current = runtime();
    if (!pending.length || !current) return;
    setError('');
    setScheduled(new Set([...scheduled(), ...pending.map((module) => module.id)]));
    try {
      const result = await installPublishedCategoryModules(current, pending, complete);
      if (result.errorMessage) setError(result.errorMessage);
      if (result.changed) await reconnectContent();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось скачать пакеты раздела.');
    } finally {
      setScheduled(
        new Set([...scheduled()].filter((id) => !pending.some((module) => module.id === id))),
      );
      refresh();
    }
  };
  return {
    catalog,
    refresh: (): void => {
      ensureRuntime();
      refresh();
    },
    preferenceRevision,
    ready,
    error,
    installedIds,
    visibleTasks,
    activeIds,
    install,
  };
}

export type SearchSectionDownloads = ReturnType<typeof useSearchSectionDownloads>;
