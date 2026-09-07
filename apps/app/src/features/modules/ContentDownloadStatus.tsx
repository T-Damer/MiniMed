import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import {
  aggregateDownloadFraction,
  type DownloadKind,
  type DownloadPhase,
  type DownloadTask,
  downloadTaskFraction,
  isDownloadActive,
} from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';

const LABELS: Readonly<Record<DownloadPhase, string>> = {
  queued: 'В очереди',
  downloading: 'Скачивается',
  retrying: 'Ожидаем повтор',
  verifying: 'Проверяем данные',
  installing: 'Сохраняем и подключаем',
  completed: 'Готово',
  failed: 'Нужен повтор',
  cancelling: 'Останавливаем',
  cancelled: 'Отменено',
  interrupted: 'Прервано перезапуском',
};
const KINDS: Readonly<Record<DownloadKind, string>> = {
  core: 'Ядро знаний',
  module: 'Набор документов',
  images: 'Изображения',
  ecg: 'ЭКГ',
  speech: 'Распознавание речи',
  model: 'Локальная модель',
  document: 'Файл',
  app: 'Обновление приложения',
};
function bytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} ГБ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} МБ`;
  return `${Math.round(value / 1_000)} КБ`;
}
function detail(task: DownloadTask): string {
  if (task.state === 'verifying') return 'Файл скачан. Проверка ещё не завершена.';
  if (task.state === 'installing') return 'Завершаем сохранение. Этот этап нельзя прервать.';
  if (task.state === 'cancelling')
    return 'Ждём подтверждения остановки; место в очереди ещё занято.';
  if (task.state === 'retrying')
    return 'Место освобождено для других загрузок. Повтор запустится автоматически.';
  if (task.state === 'interrupted') return 'Продолжить можно после сверки с текущим каталогом.';
  if (task.state === 'queued')
    return 'Запустится, когда появятся сеть и свободное место в очереди.';
  const transferred = task.totalBytes
    ? `${bytes(task.downloadedBytes)} из ${bytes(task.totalBytes)}`
    : bytes(task.downloadedBytes);
  return task.totalFiles !== null
    ? `${transferred} · Файлы: ${task.completedFiles ?? 0} / ${task.totalFiles}`
    : transferred;
}

/** A view only: opening Settings never starts a database, model or download. */
export function ContentDownloadStatus(props: { readonly compact?: boolean } = {}): JSX.Element {
  const queue = getDownloadQueue();
  const [tasks, setTasks] = createSignal(queue.list());
  const [online, setOnline] = createSignal(queue.isOnline());
  const [storageError, setStorageError] = createSignal(queue.getStorageError());
  const [error, setError] = createSignal('');
  const [filter, setFilter] = createSignal<'active' | 'all'>('active');
  const update = (): void => {
    setTasks(queue.list());
    setOnline(queue.isOnline());
    setStorageError(queue.getStorageError());
  };
  onMount(() => {
    update();
    onCleanup(queue.subscribe(update));
  });
  const active = () => tasks().filter(isDownloadActive);
  const attention = () => tasks().filter((task) => ['failed', 'interrupted'].includes(task.state));
  const visible = () =>
    [...tasks()]
      .reverse()
      .filter(
        (task) =>
          filter() === 'all' ||
          isDownloadActive(task) ||
          ['failed', 'interrupted'].includes(task.state),
      );
  const fraction = () => aggregateDownloadFraction(tasks());
  const summary = () =>
    !online()
      ? 'Нет сети. Новые передачи ожидают подключения.'
      : `Активные: ${active().length} · В очереди: ${tasks().filter((task) => task.state === 'queued').length} · Требуют внимания: ${attention().length}`;
  const act = (operation: () => Promise<void>): void => {
    setError('');
    void operation().catch(() =>
      setError('Действие не завершено. Состояние каждой загрузки указано ниже.'),
    );
  };
  return (
    <section
      class="content-download-status"
      classList={{
        'content-download-status--compact': props.compact,
        'paper-card': !props.compact,
      }}
      aria-label="Все загрузки"
      data-testid="content-download-status"
    >
      <Show
        when={props.compact}
        fallback={
          <>
            <header class="content-download-status__heading">
              <div class="content-download-status__heading-text">
                <h2 class="content-download-status__title">Все загрузки</h2>
                <p class="content-download-status__summary">{summary()}</p>
              </div>
            </header>
            <div class="content-download-status__actions">
              <button
                type="button"
                class="content-download-status__action"
                aria-pressed={filter() === 'active'}
                onClick={() => setFilter('active')}
              >
                Текущие
              </button>
              <button
                type="button"
                class="content-download-status__action"
                aria-pressed={filter() === 'all'}
                onClick={() => setFilter('all')}
              >
                История
              </button>
              <Show when={attention().some((task) => task.canRetry)}>
                <button
                  type="button"
                  class="content-download-status__action"
                  onClick={() => act(() => queue.retryFailed())}
                >
                  Повторить ошибки
                </button>
              </Show>
              <Show when={tasks().some((task) => task.canCancel)}>
                <button
                  type="button"
                  class="content-download-status__action"
                  onClick={() => act(() => queue.cancelAll())}
                >
                  Отменить все
                </button>
              </Show>
              <Show when={filter() === 'all'}>
                <button
                  type="button"
                  class="content-download-status__action"
                  onClick={() => queue.clearFinished()}
                >
                  Очистить историю
                </button>
              </Show>
            </div>
            <Show when={error() || storageError()}>
              <p class="content-download-status__manager-error" role="alert">
                {error() || storageError()}
              </p>
            </Show>
            <Show
              when={visible().length > 0}
              fallback={<p class="content-download-status__empty">Нет незавершённых загрузок</p>}
            >
              <div class="content-download-status__scroll">
                <ul class="content-download-status__list">
                  <For each={visible()}>
                    {(task) => (
                      <li
                        class="content-download-status__item"
                        data-download-id={task.id}
                        data-download-state={task.state}
                        classList={{
                          'content-download-status__item--failed': task.state === 'failed',
                          'content-download-status__item--retrying': task.state === 'retrying',
                        }}
                      >
                        <div class="content-download-status__row">
                          <div class="content-download-status__identity">
                            <strong class="content-download-status__name">{task.title}</strong>
                            <small class="content-download-status__version">
                              {KINDS[task.kind]}
                            </small>
                          </div>
                          <span class="content-download-status__state" role="status">
                            {LABELS[task.state]}
                          </span>
                        </div>
                        <Show when={downloadTaskFraction(task) !== null}>
                          <div
                            class="content-download-status__progress"
                            role="progressbar"
                            aria-label={task.title}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.floor((downloadTaskFraction(task) ?? 0) * 100)}
                          >
                            <span
                              class="content-download-status__progress-fill"
                              style={{
                                width: `${Math.floor((downloadTaskFraction(task) ?? 0) * 100)}%`,
                              }}
                            />
                          </div>
                        </Show>
                        <small class="content-download-status__detail">{detail(task)}</small>
                        <Show when={task.errorMessage}>
                          <small class="content-download-status__error">{task.errorMessage}</small>
                        </Show>
                        <div class="content-download-status__task-actions">
                          <Show when={task.canCancel}>
                            <button
                              type="button"
                              class="content-download-status__action"
                              onClick={() => act(() => queue.cancel(task.id))}
                            >
                              Отменить
                            </button>
                          </Show>
                          <Show when={task.canRetry}>
                            <button
                              type="button"
                              class="content-download-status__action"
                              onClick={() => act(() => queue.retry(task.id))}
                            >
                              Повторить сейчас
                            </button>
                          </Show>
                          <Show when={task.state === 'interrupted' && !task.canRetry}>
                            <small class="content-download-status__detail">
                              Откройте раздел этой загрузки для проверки доступной версии.
                            </small>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
            <p class="content-download-status__summary">
              Общий лимит — три передачи. Скачивание, проверка и установка показаны отдельно.
              Переход между разделами не отменяет загрузки.
            </p>
          </>
        }
      >
        <div class="content-download-status__compact-body">
          <div class="content-download-status__compact-row">
            <span class="content-download-status__compact-summary">{summary()}</span>
            <span class="content-download-status__compact-value">
              {fraction() === null ? '' : `${Math.floor((fraction() ?? 0) * 100)}%`}
            </span>
          </div>
          <Show when={fraction() !== null}>
            <div class="content-download-status__compact-progress">
              <span
                class="content-download-status__compact-progress-fill"
                style={{ width: `${(fraction() ?? 0) * 100}%` }}
              />
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
