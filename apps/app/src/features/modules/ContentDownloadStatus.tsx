import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  DownloadProgressMark,
  type DownloadProgressMarkState,
} from '@/components/DownloadProgressMark';
import { SegmentedControl } from '@/components/SegmentedControl';
import { DownloadTaskRow, formatDownloadBytes } from '@/features/downloads/DownloadTaskRow';
import {
  aggregateDownloadFraction,
  type DownloadPhase,
  type DownloadTask,
  isDownloadActive,
} from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { pluralRu } from '@/i18n/labels';

const RUNNING = new Set<DownloadPhase>(['downloading', 'verifying', 'installing', 'cancelling']);
const WAITING = new Set<DownloadPhase>(['queued', 'retrying']);
const ATTENTION = new Set<DownloadPhase>(['failed', 'interrupted']);

function downloadSummary(active: number, queued: number, attention: number): string {
  const parts: string[] = [];
  if (active > 0)
    parts.push(`${active} ${pluralRu(active, 'загрузка идёт', 'загрузки идут', 'загрузок идёт')}`);
  if (queued > 0) parts.push(`${queued} в очереди`);
  if (attention > 0)
    parts.push(`${attention} ${pluralRu(attention, 'требует', 'требуют', 'требуют')} внимания`);
  return parts.length > 0 ? parts.join(' · ') : 'Сейчас ничего не скачивается';
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
  const attention = () => tasks().filter((task) => ATTENTION.has(task.state));
  const fraction = () => aggregateDownloadFraction([...running(), ...waiting()]);
  const running = () => tasks().filter((task) => RUNNING.has(task.state));
  const waiting = () => tasks().filter((task) => WAITING.has(task.state));
  /** Attention first, then work in progress, then the queue; newest first inside each group. */
  const groups = () =>
    [
      { label: 'Требуют внимания', tasks: attention() },
      { label: 'Скачиваются', tasks: running() },
      { label: 'В очереди', tasks: waiting() },
    ]
      .map((group) => ({ ...group, tasks: [...group.tasks].reverse() }))
      .filter((group) => group.tasks.length > 0);
  const current = () => [...attention(), ...running(), ...waiting()];
  const finished = () =>
    [...tasks()].reverse().filter((task) => !isDownloadActive(task) && !ATTENTION.has(task.state));
  const canCancelAny = () => tasks().some((task) => task.canCancel);
  const overviewMark = (): DownloadProgressMarkState | undefined => {
    if (running().length > 0) return 'running';
    if (waiting().length > 0) return 'queued';
    return undefined;
  };
  const overviewTitle = (): string => {
    if (running().length > 0) return 'Идёт загрузка';
    if (waiting().length > 0) return online() ? 'Ожидают своей очереди' : 'Ждём сеть';
    if (attention().length > 0) return 'Нужна повторная попытка';
    return 'Все загрузки завершены';
  };
  const overviewMeta = (): string => {
    const parts: string[] = [];
    if (running().length > 0) parts.push(`передач: ${running().length} из 3`);
    if (waiting().length > 0) parts.push(`в очереди: ${waiting().length}`);
    if (attention().length > 0) parts.push(`с ошибкой: ${attention().length}`);
    // Failed work is not transferring; only running and waiting items make up the remaining volume.
    const withSize = [...running(), ...waiting()].filter((task) => task.totalBytes);
    if (withSize.length > 0) {
      const done = withSize.reduce((sum, task) => sum + task.downloadedBytes, 0);
      const total = withSize.reduce((sum, task) => sum + (task.totalBytes ?? 0), 0);
      parts.push(`${formatDownloadBytes(done)} из ${formatDownloadBytes(total)}`);
    }
    return parts.length > 0
      ? parts.join(' · ')
      : 'Ядро, наборы документов, изображения и модели скачиваются через одну очередь.';
  };
  const summary = () =>
    !online()
      ? 'Нет сети. Новые передачи ожидают подключения.'
      : downloadSummary(running().length, waiting().length, attention().length);
  const act = (operation: () => Promise<void>): void => {
    setError('');
    void operation().catch(() =>
      setError('Действие не завершено. Состояние каждой загрузки указано ниже.'),
    );
  };
  const cancel = (task: DownloadTask): void => act(() => queue.cancel(task.id));
  const retry = (task: DownloadTask): void => act(() => queue.retry(task.id));
  return (
    <section
      class="content-download-status"
      classList={{ 'content-download-status--compact': props.compact }}
      aria-label="Все загрузки"
      data-testid="content-download-status"
    >
      <Show
        when={props.compact}
        fallback={
          <>
            <section
              class="downloads-overview paper-card"
              classList={{
                'downloads-overview--attention': attention().length > 0 && !overviewMark(),
              }}
              aria-live="polite"
            >
              <span class="downloads-overview__mark">
                <Show
                  when={overviewMark()}
                  fallback={
                    <AppGlyph
                      name={attention().length > 0 ? 'close' : 'check'}
                      class="downloads-overview__glyph"
                    />
                  }
                >
                  {(state) => (
                    <DownloadProgressMark
                      class="downloads-overview__progress"
                      state={state()}
                      progress={fraction()}
                    />
                  )}
                </Show>
              </span>
              <div class="downloads-overview__copy">
                <h2 class="downloads-overview__title">{overviewTitle()}</h2>
                <p class="downloads-overview__meta">{overviewMeta()}</p>
              </div>
              <Show when={attention().some((task) => task.canRetry) || canCancelAny()}>
                <div class="downloads-overview__actions">
                  <Show when={attention().some((task) => task.canRetry)}>
                    <Button
                      variant="primary"
                      icon={<AppGlyph name="arrow-counter-clockwise" class="downloads-glyph" />}
                      onClick={() => act(() => queue.retryFailed())}
                    >
                      Повторить ошибки
                    </Button>
                  </Show>
                  <Show when={canCancelAny()}>
                    <Button
                      variant="secondary"
                      icon={<AppGlyph name="close" class="downloads-glyph" />}
                      onClick={() => act(() => queue.cancelAll())}
                    >
                      Отменить все
                    </Button>
                  </Show>
                </div>
              </Show>
            </section>
            <Show when={!online()}>
              <p class="downloads-banner" role="status">
                Нет сети. Передачи продолжатся после подключения.
              </p>
            </Show>
            <Show when={error() || storageError()}>
              <p class="downloads-banner downloads-banner--error" role="alert">
                {error() || storageError()}
              </p>
            </Show>
            <div class="downloads-toolbar">
              <SegmentedControl
                label="Показать загрузки"
                value={filter()}
                onChange={setFilter}
                options={[
                  { value: 'active', label: 'Текущие', count: current().length },
                  { value: 'all', label: 'История' },
                ]}
              />
              <Show when={filter() === 'all' && finished().length > 0}>
                <Button variant="quiet" onClick={() => queue.clearFinished()}>
                  Очистить историю
                </Button>
              </Show>
            </div>
            <Show
              when={filter() === 'active'}
              fallback={
                <Show
                  when={finished().length > 0}
                  fallback={<p class="downloads-empty">История пуста.</p>}
                >
                  <ul class="downloads-group__list paper-card">
                    <For each={finished()}>
                      {(task) => <DownloadTaskRow task={task} onCancel={cancel} onRetry={retry} />}
                    </For>
                  </ul>
                </Show>
              }
            >
              <Show
                when={current().length > 0}
                fallback={
                  <p class="downloads-empty">
                    Здесь появятся загрузки, когда вы начнёте что-нибудь скачивать.
                  </p>
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <section class="downloads-group" aria-label={group.label}>
                      <h3 class="downloads-group__title">
                        {group.label}
                        <span class="downloads-group__count">{group.tasks.length}</span>
                      </h3>
                      <ul class="downloads-group__list paper-card">
                        <For each={group.tasks}>
                          {(task) => (
                            <DownloadTaskRow task={task} onCancel={cancel} onRetry={retry} />
                          )}
                        </For>
                      </ul>
                    </section>
                  )}
                </For>
              </Show>
            </Show>
            <p class="downloads-footnote">
              Одновременно идёт до трёх загрузок. Их можно не ждать: переход в другие разделы
              загрузку не прерывает.
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
