import type { ContentModuleDownloadTask } from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { BrowserContentModuleRuntime } from './browser-module-runtime';
import { MODULE_CATALOG } from './module-catalog';

const TASK_LABELS: Readonly<Record<ContentModuleDownloadTask['state'], string>> = {
  queued: 'Ожидает загрузки',
  downloading: 'Скачивается',
  verifying: 'Проверяется',
  installing: 'Устанавливается',
  completed: 'Установлено',
  failed: 'Ошибка установки',
  cancelled: 'Загрузка отменена',
};

function taskProgress(task: ContentModuleDownloadTask): number | null {
  if (!task.totalBytes || task.totalBytes <= 0) return null;
  return Math.max(0, Math.min(1, task.downloadedBytes / task.totalBytes));
}

export function ContentDownloadStatus(): JSX.Element {
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  let unsubscribe: (() => void) | undefined;

  onMount(() => {
    const runtime = new BrowserContentModuleRuntime(MODULE_CATALOG);
    const refresh = (): void => {
      setTasks(runtime.listTasks());
    };
    refresh();
    unsubscribe = runtime.subscribe(() => refresh());
  });
  onCleanup(() => unsubscribe?.());

  const activeTasks = () =>
    tasks().filter((task) => !['completed', 'failed', 'cancelled'].includes(task.state));

  return (
    <Show when={activeTasks().length > 0}>
      <section class="content-download-status paper-card" aria-label="Загрузка наборов документов">
        <h3>Загрузка наборов</h3>
        <ul>
          <For each={activeTasks()}>
            {(task) => {
              const progress = () => taskProgress(task);
              return (
                <li>
                  <div class="content-download-status-row">
                    <strong>{task.moduleId}</strong>
                    <span>{TASK_LABELS[task.state]}</span>
                  </div>
                  <Show when={progress() !== null}>
                    <div class="content-download-status-progress" role="progressbar">
                      <i style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} />
                    </div>
                  </Show>
                  <Show when={task.errorMessage}>{(message) => <small>{message()}</small>}</Show>
                </li>
              );
            }}
          </For>
        </ul>
      </section>
    </Show>
  );
}
