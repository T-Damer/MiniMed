import type { ContentModuleDownloadTask } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import {
  activeContentDownloadTasks,
  downloadNavPieBackground,
  downloadProgressFraction,
} from '@/features/modules/content-download-progress';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { SETTINGS_DOWNLOADS_HASH } from '@/features/settings/settings-routing';

function openDownloads(): void {
  if (window.location.hash === SETTINGS_DOWNLOADS_HASH) return;
  window.location.hash = SETTINGS_DOWNLOADS_HASH;
}

export function ContentDownloadNavIndicator(): JSX.Element {
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  let unsubscribeTasks: (() => void) | undefined;
  let unsubscribeRuntime: (() => void) | undefined;

  onMount(() => {
    unsubscribeRuntime = subscribeContentModuleRuntime((runtime) => {
      unsubscribeTasks?.();
      setTasks(runtime.listTasks());
      unsubscribeTasks = runtime.subscribe(() => setTasks(runtime.listTasks()));
    });
    if (!peekContentModuleRuntime()) getContentModuleRuntime(MODULE_CATALOG);
  });
  onCleanup(() => {
    unsubscribeTasks?.();
    unsubscribeRuntime?.();
  });

  const active = () => activeContentDownloadTasks(tasks());
  const progress = () => downloadProgressFraction(active());
  const label = (): string => {
    const fraction = Math.round(progress() * 100);
    return `Загрузка наборов: ${fraction}%. Открыть загрузки`;
  };

  return (
    <Show when={active().length > 0}>
      <div class="content-download-nav">
        <button
          type="button"
          class="content-download-nav__pie"
          style={{ background: downloadNavPieBackground(progress(), false) }}
          data-testid="content-download-nav"
          title={label()}
          aria-label={label()}
          onClick={(event) => {
            event.stopPropagation();
            openDownloads();
          }}
        />
      </div>
    </Show>
  );
}
