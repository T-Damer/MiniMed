import type { ContentModuleDownloadTask } from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';

const TASK_LABELS: Readonly<Record<ContentModuleDownloadTask['state'], string>> = {
  queued: 'Ожидает загрузки',
  downloading: 'Скачивается',
  verifying: 'Проверяется',
  installing: 'Устанавливается',
  completed: 'Установлено',
  failed: 'Загрузка прервана',
  cancelled: 'Загрузка отменена',
};

function taskProgress(task: ContentModuleDownloadTask): number | null {
  if (!task.totalBytes || task.totalBytes <= 0) return null;
  return Math.max(0, Math.min(1, task.downloadedBytes / task.totalBytes));
}

function latestVisibleTasks(
  tasks: readonly ContentModuleDownloadTask[],
): readonly ContentModuleDownloadTask[] {
  const seen = new Set<string>();
  const latest: ContentModuleDownloadTask[] = [];
  for (const task of [...tasks].reverse()) {
    if (['completed', 'cancelled'].includes(task.state)) continue;
    const key = `${task.moduleId}@${task.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(task);
  }
  return latest.reverse();
}

export function ContentDownloadStatus(): JSX.Element {
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  let currentRuntime: BrowserContentModuleRuntime | undefined;
  let unsubscribeTasks: (() => void) | undefined;
  let unsubscribeRuntime: (() => void) | undefined;

  const bindRuntime = (runtime: BrowserContentModuleRuntime): void => {
    if (runtime === currentRuntime) return;
    unsubscribeTasks?.();
    currentRuntime = runtime;
    setTasks(runtime.listTasks());
    unsubscribeTasks = runtime.subscribe(() => setTasks(runtime.listTasks()));
  };

  onMount(() => {
    bindRuntime(getContentModuleRuntime(MODULE_CATALOG));
    unsubscribeRuntime = subscribeContentModuleRuntime(bindRuntime);
  });
  onCleanup(() => {
    unsubscribeTasks?.();
    unsubscribeRuntime?.();
  });

  const visibleTasks = () => latestVisibleTasks(tasks());

  const retry = (task: ContentModuleDownloadTask): void => {
    const runtime = currentRuntime;
    if (!runtime) return;
    const module = runtime
      .getCatalog()
      .modules.find(
        (candidate) => candidate.id === task.moduleId && candidate.version === task.version,
      );
    if (!module || module.releaseState !== 'published') return;
    runtime.install(module);
    setTasks(runtime.listTasks());
  };

  return (
    <Show when={visibleTasks().length > 0}>
      <section
        class="content-download-status paper-card"
        aria-label="Загрузка наборов документов"
        data-testid="content-download-status"
      >
        <header class="content-download-status-heading">
          <div>
            <h3>Загрузка наборов</h3>
            <p>
              Частичные данные сохраняются. После перезапуска загрузка продолжится автоматически.
            </p>
          </div>
          <span>{visibleTasks().length}</span>
        </header>
        <ul>
          <For each={visibleTasks()}>
            {(task) => {
              const progress = () => taskProgress(task);
              const retryAvailable = () =>
                task.state === 'failed' &&
                Boolean(
                  currentRuntime
                    ?.getCatalog()
                    .modules.some(
                      (module) =>
                        module.id === task.moduleId &&
                        module.version === task.version &&
                        module.releaseState === 'published',
                    ),
                );
              return (
                <li classList={{ failed: task.state === 'failed' }}>
                  <div class="content-download-status-row">
                    <div>
                      <strong>{task.moduleId}</strong>
                      <small>Версия {task.version}</small>
                    </div>
                    <span>{TASK_LABELS[task.state]}</span>
                  </div>
                  <Show when={progress() !== null}>
                    <div
                      class="content-download-status-progress"
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={Math.round((progress() ?? 0) * 100)}
                    >
                      <i style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} />
                    </div>
                  </Show>
                  <Show when={task.errorMessage}>{(message) => <small>{message()}</small>}</Show>
                  <Show when={retryAvailable()}>
                    <button type="button" onClick={() => retry(task)}>
                      Продолжить сейчас
                    </button>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </section>
    </Show>
  );
}
