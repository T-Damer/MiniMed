import type { ContentModuleDownloadTask } from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { contentModuleTaskProgress } from '@/features/modules/module-display';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';

interface ContentDownloadStatusProps {
  readonly floating?: boolean;
}

interface TaskMetrics {
  readonly speedBytesPerSecond: number | null;
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

function aggregateProgress(tasks: readonly ContentModuleDownloadTask[]): number | null {
  let downloaded = 0;
  let total = 0;
  for (const task of tasks) {
    if (!task.totalBytes || task.totalBytes <= 0) continue;
    downloaded += task.downloadedBytes;
    total += task.totalBytes;
  }
  if (total <= 0) return null;
  return Math.max(0, Math.min(1, downloaded / total));
}

export function ContentDownloadStatus(props: ContentDownloadStatusProps = {}): JSX.Element {
  const [tasks, setTasks] = createSignal<readonly ContentModuleDownloadTask[]>([]);
  const [metrics, setMetrics] = createSignal<Readonly<Record<string, TaskMetrics>>>({});
  const [online, setOnline] = createSignal(navigator.onLine);
  const [managerError, setManagerError] = createSignal('');
  // The floating card starts as a compact pill: downloads run on their own, so the expanded panel
  // is only worth screen space when the doctor asks for it.
  const [collapsed, setCollapsed] = createSignal(Boolean(props.floating));
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

  const visibleTasks = () => latestVisibleTasks(tasks());
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
    return parts.join(' · ') || 'Проверяем и подключаем загруженные документы.';
  };

  const moduleTitle = (task: ContentModuleDownloadTask): string =>
    currentRuntime
      ?.getCatalog()
      .modules.find((module) => module.id === task.moduleId && module.version === task.version)
      ?.title ?? task.moduleId;

  return (
    <Show when={visibleTasks().length > 0}>
      <Show when={!props.floating || !collapsed()}>
        <section
          class="content-download-status"
          classList={{ floating: Boolean(props.floating) }}
          aria-label="Загрузка наборов документов"
          data-testid="content-download-status"
        >
          <header class="content-download-status-heading">
            <div>
              <h3>Загрузка наборов</h3>
              <p>{summary()}</p>
            </div>
            <Show when={!props.floating}>
              <span class="content-download-count">{visibleTasks().length}</span>
            </Show>
          </header>
          <Show when={activeTasks().length > 0 || failedTasks().length > 0}>
            <div class="content-download-status-actions">
              <Show when={failedTasks().length > 0}>
                <button
                  type="button"
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
                <button type="button" onClick={() => currentRuntime?.cancelAll()}>
                  Отменить все
                </button>
              </Show>
            </div>
          </Show>
          <Show when={managerError()}>
            <p class="content-download-manager-error" role="alert">
              {managerError()}
            </p>
          </Show>
          <div class="content-download-scroll">
            <ul>
              <For each={visibleTasks()}>
                {(task) => {
                  const progress = () => contentModuleTaskProgress(task);
                  return (
                    <li
                      classList={{
                        failed: task.state === 'failed' && !retryScheduled(task),
                        retrying: retryScheduled(task),
                      }}
                    >
                      <div class="content-download-status-row">
                        <div>
                          <strong title={task.moduleId}>{moduleTitle(task)}</strong>
                          <small>Версия {task.version}</small>
                        </div>
                        <span>{taskLabel(task)}</span>
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
                        {describeTask(
                          task,
                          metrics()[task.id],
                          retryScheduled(task),
                          queuePosition(task),
                        )}
                      </small>
                      <Show when={retryScheduled(task) ? null : task.errorMessage}>
                        {(message) => (
                          <small class="content-download-status-error">
                            {sanitizeErrorMessage(message())}
                          </small>
                        )}
                      </Show>
                      <div class="content-download-task-actions">
                        <Show when={!['completed', 'failed', 'cancelled'].includes(task.state)}>
                          <button type="button" onClick={() => currentRuntime?.cancel(task.id)}>
                            Отменить
                          </button>
                        </Show>
                        <Show when={task.state === 'failed'}>
                          <button
                            type="button"
                            onClick={() => {
                              setManagerError('');
                              try {
                                currentRuntime?.retry(task.id);
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
                          <Show when={retryScheduled(task)}>
                            <button type="button" onClick={() => currentRuntime?.cancel(task.id)}>
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
        </section>
      </Show>
      <Show when={props.floating}>
        <button
          type="button"
          class="content-download-pill"
          data-testid="content-download-status"
          aria-expanded={!collapsed()}
          aria-label={
            collapsed()
              ? `Загрузка наборов: ${visibleTasks().length}. Показать детали`
              : 'Свернуть панель загрузок'
          }
          onClick={() => setCollapsed((value) => !value)}
        >
          <span
            class="content-download-ring"
            style={{
              background: `conic-gradient(#e8c654 ${Math.round(
                (aggregateProgress(visibleTasks()) ?? 0.08) * 100,
              )}%, rgb(246 238 219 / 18%) 0)`,
            }}
            aria-hidden="true"
          >
            <AppGlyph name={collapsed() ? 'download' : 'minus'} />
          </span>
        </button>
      </Show>
    </Show>
  );
}
