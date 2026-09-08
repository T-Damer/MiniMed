import type { ContentModuleCatalogEntry } from '@localmed/contracts';
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
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { installPublishedCategoryModules } from '@/features/modules/recommendation-category-operations';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';

export function useSearchSectionDownloads(open: Accessor<boolean>, connect: () => Promise<void>) {
  const runtime = peekContentModuleRuntime() ?? getContentModuleRuntime(MODULE_CATALOG);
  const [catalog, setCatalog] = createSignal(runtime.getCatalog());
  const [installed, setInstalled] = createSignal(runtime.listInstalled());
  const [tasks, setTasks] = createSignal(runtime.listTasks());
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal('');
  const [scheduled, setScheduled] = createSignal<ReadonlySet<string>>(new Set());
  const [preferenceRevision, setPreferenceRevision] = createSignal(0);
  let reconnect: Promise<void> | undefined;
  let reconnectPending = false;
  const refresh = (): void =>
    batch(() => {
      setCatalog(runtime.getCatalog());
      setInstalled(runtime.listInstalled());
      setTasks(runtime.listTasks());
    });
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
  onMount(() => {
    onCleanup(runtime.subscribe(refresh));
    onCleanup(subscribeAppPreferences(() => setPreferenceRevision((value) => value + 1)));
    window.addEventListener(CONTENT_CHANGED_EVENT, refresh);
    onCleanup(() => window.removeEventListener(CONTENT_CHANGED_EVENT, refresh));
    void runtime
      .whenLocalPackagedModulesReady()
      .then(() => {
        batch(() => {
          refresh();
          setReady(true);
        });
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Не удалось проверить локальные пакеты.'),
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
    if (!pending.length) return;
    setError('');
    setScheduled(new Set([...scheduled(), ...pending.map((module) => module.id)]));
    try {
      const result = await installPublishedCategoryModules(runtime, pending, complete);
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
    preferenceRevision,
    ready,
    error,
    installedIds,
    visibleTasks,
    activeIds,
    install,
  };
}
