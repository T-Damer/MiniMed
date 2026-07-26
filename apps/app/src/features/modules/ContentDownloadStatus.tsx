import type { ContentModuleDownloadTask } from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';

interface ContentDownloadStatusProps {
  readonly floating?: boolean;
}

interface TaskMetrics {
  readonly speedBytesPerSecond: number | null;
}

const TASK_LABELS: Readonly<Record<ContentModuleDownloadTask['state'], string>> = {
  queued: 'Ожидает загрузки',
  downloading: 'Скачивается',
  verifying: 'Проверяем базу',
  installing: 'Подключаем к поиску',
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
    if (task.state === 'completed' || task.state === 'cancelled') continue;
    const key = `${task.moduleId}@${task.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(task);
  }
  return latest.reverse();
}

function formatBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} ГБ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} МБ`;
  return `${Math.max(1, Math.round(value / 1_000))} КБ`;
}

function sanitizeErrorMessage(message: string | null): string | null {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (
    normalized.includes('network error') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('http 5') ||
    normalized.includes('http 429') ||
    normalized.includes('load failed')
  ) {
    return 'Сеть оборвалась. Частичные данные сохранены, повтор можно запустить без потери прогресса.';
  }
  return message;
}

function describeTask(task: ContentModuleDownloadTask, metrics: TaskMetrics | undefined): string {
  const progress = taskProgress(task);
  if (task.state === 'queued') return 'Ждём свободный слот загрузки.';
  if (task.state === 'downloading') {
    const parts = [];
    if (task.downloadedBytes > 0) {
      parts.push(
        task.totalBytes
          ? `${formatBytes(task.downloadedBytes)} из ${formatBytes(task.totalBytes)}`
          : formatBytes(task.downloadedBytes),
      );
    }
    if (progress !== null) parts.push(`${Math.round(progress * 100)}%`);
    if (metrics?.speedBytesPerSecond) {
      parts.push(`${formatBytes(metrics.speedBytesPerSecond)}/с`);
    }
    return parts.join(' · ');
  }
  if (task.state === 'verifying') return 'Проверяем SHA-256 и целостность SQLite.';
  if (task.state === 'installing') return 'Подключаем новые документы к локальному поиску.';
  return sanitizeErrorMessage(task.errorMessage) ?? '';
}

export function ContentDownloadStatus(props: ContentDownloadStatusProps = {}): JSX.Element {
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  const [metrics, setMetrics] = createSignal<Readonly<Record<string, TaskMetrics>>>({});
  let currentRuntime: BrowserContentModuleRuntime | undefined;
  let unsubscribeTasks: (() => void) | undefined;
  let unsubscribeRuntime: (() => void) | undefined;
  let previousSnapshot = new Map<
    string,
    { downloadedBytes: number; capturedAt: number; speedBytesPerSecond: number | null }
  >();

  const updateTasks = (runtime: BrowserContentModuleRuntime): void => {
    const nextTasks = runtime.listTasks();
    const now = Date.now();
    const nextMetrics: Record<string, TaskMetrics> = {};
    const nextSnapshot = new Map<
      string,
      { downloadedBytes: number; capturedAt: number; speedBytesPerSecond: number | null }
    >();

    for (const task of nextTasks) {
      const previous = previousSnapshot.get(task.id);
      let speedBytesPerSecond: number | null = previous?.speedBytesPerSecond ?? null;
      if (task.state === 'downloading' && previous) {
        const elapsedSeconds = Math.max(0.001, (now - previous.capturedAt) / 1000);
        const delta = task.downloadedBytes - previous.downloadedBytes;
        if (delta > 0) speedBytesPerSecond = delta / elapsedSeconds;
      }
      nextMetrics[task.id] = { speedBytesPerSecond };
      nextSnapshot.set(task.id, {
        downloadedBytes: task.downloadedBytes,
        capturedAt: now,
        speedBytesPerSecond,
      });
    }

    previousSnapshot = nextSnapshot;
    setMetrics(nextMetrics);
    setTasks(nextTasks);
  };

  const bindRuntime = (runtime: BrowserContentModuleRuntime): void => {
    if (runtime === currentRuntime) return;
    unsubscribeTasks?.();
    currentRuntime = runtime;
    updateTasks(runtime);
    unsubscribeTasks = runtime.subscribe(() => updateTasks(runtime));
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
    updateTasks(runtime);
  };

  return (
    <Show when={visibleTasks().length > 0}>
      <section
        class="content-download-status paper-card"
        classList={{ floating: Boolean(props.floating) }}
        aria-label="Загрузка наборов документов"
        data-testid="content-download-status"
      >
        <header class="content-download-status-heading">
          <div>
            <h3>Загрузка наборов</h3>
            <p>
              Частичные данные сохраняются. После перезапуска MiniMed продолжит загрузку
              автоматически.
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
                  <small class="content-download-status-detail">
                    {describeTask(task, metrics()[task.id])}
                  </small>
                  <Show when={task.errorMessage}>
                    {(message) => (
                      <small class="content-download-status-error">
                        {sanitizeErrorMessage(message())}
                      </small>
                    )}
                  </Show>
                  <Show when={retryAvailable()}>
                    <button type="button" onClick={() => retry(task)}>
                      Повторить сейчас
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
