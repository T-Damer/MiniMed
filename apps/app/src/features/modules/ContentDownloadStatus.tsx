import type { ContentModuleDownloadTask } from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import {
  aggregateDownloadProgress,
  downloadProgressFraction,
  latestVisibleDownloadTasks,
} from '@/features/modules/content-download-progress';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { contentModuleTaskProgress } from '@/features/modules/module-display';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';

interface TaskMetrics {
  readonly speedBytesPerSecond: number | null;
}

interface ContentDownloadStatusProps {
  readonly compact?: boolean;
}

const TASK_LABELS: Readonly<Record<ContentModuleDownloadTask['state'], string>> = {
  queued: 'В очереди',
  downloading: 'Скачивается',
  verifying: 'Проверяем базу',
  installing: 'Подключаем к поиску',
  completed: 'Установлено',
  failed: 'Загрузка прервана',
  cancelled: 'Загрузка отменена',
};

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

function describeTask(
  task: ContentModuleDownloadTask,
  metrics: TaskMetrics | undefined,
  retryScheduled: boolean,
  queuePosition: number,
): string {
  const progress = contentModuleTaskProgress(task);
  if (task.state === 'queued') return `В очереди: ${queuePosition}. Запустится автоматически.`;
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
    return parts.join(' · ') || 'Подключаемся к источнику…';
  }
  if (task.state === 'verifying') return 'Проверяем SHA-256 и целостность SQLite.';
  if (task.state === 'installing') return 'Подключаем новые документы к локальному поиску.';
  if (task.state === 'failed' && retryScheduled) {
    return 'Сеть недоступна. Освободили слот и повторим автоматически.';
  }
  if (task.state === 'failed') return 'Автоматический повтор остановлен: нужна проверка ошибки.';
  return sanitizeErrorMessage(task.errorMessage) ?? '';
}

export function ContentDownloadStatus(props: ContentDownloadStatusProps = {}): JSX.Element {
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  const [metrics, setMetrics] = createSignal<Readonly<Record<string, TaskMetrics>>>({});
  const [online, setOnline] = createSignal(navigator.onLine);
  const [managerError, setManagerError] = createSignal('');
  let currentRuntime: BrowserContentModuleRuntime | undefined;
  let unsubscribeTasks: (() => void) | undefined;
  let unsubscribeRuntime: (() => void) | undefined;
  let previousSnapshot = new Map<
    string,
    { downloadedBytes: number; capturedAt: number; speedBytesPerSecond: number | null }
  >();
  const handleOnline = (): void => {
    setOnline(true);
  };
  const handleOffline = (): void => {
    setOnline(false);
  };

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
    unsubscribeRuntime = subscribeContentModuleRuntime(bindRuntime);
    if (!peekContentModuleRuntime()) bindRuntime(getContentModuleRuntime(MODULE_CATALOG));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  });
  onCleanup(() => {
    unsubscribeTasks?.();
    unsubscribeRuntime?.();
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  });

  const visibleTasks = () => latestVisibleDownloadTasks(tasks());
  const aggregateProgress = () => aggregateDownloadProgress(visibleTasks());
  const progressFraction = () => downloadProgressFraction(visibleTasks());
  const activeTasks = () =>
    visibleTasks().filter((task) => !['completed', 'failed', 'cancelled'].includes(task.state));
  const failedTasks = () => visibleTasks().filter((task) => task.state === 'failed');
  const retryScheduled = (task: ContentModuleDownloadTask): boolean =>
    currentRuntime?.isRetryScheduled(task) ?? false;
  const queuePosition = (task: ContentModuleDownloadTask): number =>
    Math.max(
      1,
      visibleTasks()
        .filter((candidate) => candidate.state === 'queued')
        .findIndex((candidate) => candidate.id === task.id) + 1,
    );
  const taskLabel = (task: ContentModuleDownloadTask): string =>
    retryScheduled(task) ? 'Повторим автоматически' : TASK_LABELS[task.state];
  const summary = (): string => {
    if (!online()) return 'Нет сети — загрузки продолжатся автоматически после подключения.';
    const downloading = visibleTasks().filter((task) => task.state === 'downloading').length;
    const queued = visibleTasks().filter((task) => task.state === 'queued').length;
    const parts = [
      downloading > 0 ? `${downloading} скачивается` : '',
      queued > 0 ? `${queued} в очереди` : '',
      failedTasks().length > 0 ? `${failedTasks().length} требует внимания` : '',
    ].filter(Boolean);
    return parts.join(' · ') || 'Тут будут ваши загрузки';
  };

  const moduleTitle = (task: ContentModuleDownloadTask): string =>
    currentRuntime
      ?.getCatalog()
      .modules.find((module) => module.id === task.moduleId && module.version === task.version)
      ?.title ?? task.moduleId;

  return (
    <section
      class="content-download-status"
      classList={{
        'content-download-status--compact': props.compact,
        'paper-card': !props.compact,
      }}
      aria-label="Загрузка наборов документов"
      data-testid="content-download-status"
    >
      <Show when={!props.compact}>
        <header class="content-download-status__heading">
          <div class="content-download-status__heading-text">
            <h2 class="content-download-status__title">Загрузка наборов</h2>
            <p class="content-download-status__summary">{summary()}</p>
          </div>
          <Show when={visibleTasks().length > 0}>
            <span class="content-download-status__count">{visibleTasks().length}</span>
          </Show>
        </header>
      </Show>
      <Show
        when={props.compact}
        fallback={
          <>
            <Show when={activeTasks().length > 0 || failedTasks().length > 0}>
              <div class="content-download-status__actions">
                <Show when={failedTasks().length > 0}>
                  <button
                    type="button"
                    class="content-download-status__action"
                    onClick={() => {
                      setManagerError('');
                      try {
                        currentRuntime?.retryFailed();
                      } catch (cause) {
                        setManagerError(
                          cause instanceof Error ? cause.message : 'Не удалось повторить загрузки.',
                        );
                      }
                    }}
                  >
                    Повторить ошибки
                  </button>
                </Show>
                <Show when={activeTasks().length > 0}>
                  <button
                    type="button"
                    class="content-download-status__action"
                    onClick={() => currentRuntime?.cancelAll()}
                  >
                    Отменить все
                  </button>
                </Show>
              </div>
            </Show>
            <Show when={managerError()}>
              <p class="content-download-status__manager-error" role="alert">
                {managerError()}
              </p>
            </Show>
            <Show
              when={visibleTasks().length > 0}
              fallback={<p class="content-download-status__empty">Тут будут ваши загрузки</p>}
            >
              <div class="content-download-status__scroll">
                <ul class="content-download-status__list">
                  <For each={visibleTasks()}>
                    {(item) => {
                      const progress = () => contentModuleTaskProgress(item);
                      return (
                        <li
                          class="content-download-status__item"
                          classList={{
                            'content-download-status__item--failed':
                              item.state === 'failed' && !retryScheduled(item),
                            'content-download-status__item--retrying': retryScheduled(item),
                          }}
                        >
                          <div class="content-download-status__row">
                            <div class="content-download-status__identity">
                              <strong class="content-download-status__name" title={item.moduleId}>
                                {moduleTitle(item)}
                              </strong>
                              <small class="content-download-status__version">
                                Версия {item.version}
                              </small>
                            </div>
                            <span class="content-download-status__state">{taskLabel(item)}</span>
                          </div>
                          <Show when={progress() !== null}>
                            <div
                              class="content-download-status__progress"
                              role="progressbar"
                              aria-valuemin="0"
                              aria-valuemax="100"
                              aria-valuenow={Math.round((progress() ?? 0) * 100)}
                            >
                              <span
                                class="content-download-status__progress-fill"
                                style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }}
                              />
                            </div>
                          </Show>
                          <small class="content-download-status__detail">
                            {describeTask(
                              item,
                              metrics()[item.id],
                              retryScheduled(item),
                              queuePosition(item),
                            )}
                          </small>
                          <Show when={retryScheduled(item) ? null : item.errorMessage}>
                            {(message) => (
                              <small class="content-download-status__error">
                                {sanitizeErrorMessage(message())}
                              </small>
                            )}
                          </Show>
                          <div class="content-download-status__task-actions">
                            <Show when={!['completed', 'failed', 'cancelled'].includes(item.state)}>
                              <button
                                type="button"
                                class="content-download-status__action"
                                onClick={() => currentRuntime?.cancel(item.id)}
                              >
                                Отменить
                              </button>
                            </Show>
                            <Show when={item.state === 'failed'}>
                              <button
                                type="button"
                                class="content-download-status__action"
                                onClick={() => {
                                  setManagerError('');
                                  try {
                                    currentRuntime?.retry(item.id);
                                  } catch (cause) {
                                    setManagerError(
                                      cause instanceof Error
                                        ? cause.message
                                        : 'Не удалось повторить загрузку.',
                                    );
                                  }
                                }}
                              >
                                Повторить сейчас
                              </button>
                              <Show when={retryScheduled(item)}>
                                <button
                                  type="button"
                                  class="content-download-status__action"
                                  onClick={() => currentRuntime?.cancel(item.id)}
                                >
                                  Не загружать
                                </button>
                              </Show>
                            </Show>
                          </div>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </div>
            </Show>
          </>
        }
      >
        <div class="content-download-status__compact-body">
          <div class="content-download-status__compact-row">
            <span class="content-download-status__compact-summary">{summary()}</span>
            <Show when={visibleTasks().length > 0}>
              <span class="content-download-status__compact-value">
                {aggregateProgress() === null
                  ? 'Идёт загрузка'
                  : `${Math.round((aggregateProgress() ?? 0) * 100)}%`}
              </span>
            </Show>
          </div>
          <Show when={visibleTasks().length > 0}>
            <div
              class="content-download-status__compact-progress"
              role="progressbar"
              aria-label="Прогресс загрузки наборов"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={
                aggregateProgress() === null
                  ? undefined
                  : Math.round((aggregateProgress() ?? 0) * 100)
              }
            >
              <span
                class="content-download-status__compact-progress-fill"
                style={{ width: `${Math.round(progressFraction() * 100)}%` }}
              />
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
