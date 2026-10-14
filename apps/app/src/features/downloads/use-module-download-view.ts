import { type Accessor, createMemo, createSignal, onCleanup, onMount } from 'solid-js';

import { getDownloadQueue } from '@/features/downloads/download-service';
import {
  type ModuleDownloadView,
  moduleDownloadView,
} from '@/features/downloads/module-download-view';
import { listPendingModuleInstalls } from '@/features/modules/pending-module-installs';
import type { ModuleInstaller } from '@/features/sections/use-module-installer';

function pendingIds(): ReadonlySet<string> {
  try {
    return new Set(listPendingModuleInstalls().map((pending) => pending.moduleId));
  } catch (cause) {
    console.warn('Очередь отложенных установок не прочитана.', cause);
    return new Set<string>();
  }
}

/**
 * The single download state of one module for every offer: the shared download queue (persisted,
 * so it is correct on the first frame after a screen is reopened), the module runtime once it is
 * loaded, and the durable install intents that survive a reload.
 */
export function useModuleDownloadView(
  moduleId: Accessor<string>,
  installer: ModuleInstaller,
): Accessor<ModuleDownloadView> {
  const queue = getDownloadQueue();
  const [queueTasks, setQueueTasks] = createSignal(queue.list());
  const [pending, setPending] = createSignal<ReadonlySet<string>>(pendingIds());
  onMount(() => {
    const sync = (): void => {
      setQueueTasks(queue.list());
      setPending(pendingIds());
    };
    sync();
    onCleanup(queue.subscribe(sync));
  });
  return createMemo(() => {
    const snapshot = installer.snapshot();
    return moduleDownloadView({
      moduleId: moduleId(),
      installed: snapshot?.installedIds.has(moduleId()) ?? false,
      queueTasks: queueTasks(),
      runtimeTasks: snapshot?.tasks ?? [],
      pendingModuleIds: pending(),
      starting: installer.starting(),
    });
  });
}
