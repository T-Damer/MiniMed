import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  DownloadProgressMark,
  type DownloadProgressMarkState,
} from '@/components/DownloadProgressMark';
import { SegmentedControl } from '@/components/SegmentedControl';
import { DownloadsPauseButton } from '@/features/downloads/DownloadsPauseButton';
import { DownloadTaskList } from '@/features/downloads/DownloadTaskList';
import { formatDownloadBytes } from '@/features/downloads/DownloadTaskRow';
import {
  aggregateDownloadFraction,
  type DownloadPhase,
  type DownloadTask,
  isDownloadActive,
} from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { useDownloadsPause } from '@/features/downloads/use-downloads-pause';
import { pluralRu } from '@/i18n/labels';

const RUNNING = new Set<DownloadPhase>(['downloading', 'verifying', 'installing', 'cancelling']);
const WAITING = new Set<DownloadPhase>(['queued', 'retrying']);
const ATTENTION = new Set<DownloadPhase>(['failed', 'interrupted']);
const PAUSED = new Set<DownloadPhase>(['paused']);
const REFRESH_INTERVAL_MS = 250;

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
  const pause = useDownloadsPause();
  const [filter, setFilter] = createSignal<'active' | 'all'>('active');
  const update = (): void => {
    setTasks(queue.list());
    setOnline(queue.isOnline());
    setStorageError(queue.getStorageError());
  };
  // The queue emits on every progress tick and holds up to ~840 entries after «Скачать всё»: the
  // page follows it at most four times a second (trailing), so a big queue never competes with taps.
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRefresh = 0;
  const scheduleUpdate = (): void => {
    if (refreshTimer !== undefined) return;
    const wait = Math.max(0, REFRESH_INTERVAL_MS - (Date.now() - lastRefresh));
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      lastRefresh = Date.now();
      update();
    }, wait);
  };
  onMount(() => {
    update();
    lastRefresh = Date.now();
    onCleanup(queue.subscribe(scheduleUpdate));
    onCleanup(() => clearTimeout(refreshTimer));
  });
  const attention = () => tasks().filter((task) => ATTENTION.has(task.state));
  const fraction = () => aggregateDownloadFraction([...running(), ...held(), ...waiting()]);
  const running = () => tasks().filter((task) => RUNNING.has(task.state));
  const waiting = () => tasks().filter((task) => WAITING.has(task.state));
  const held = () => tasks().filter((task) => PAUSED.has(task.state));
  /** Attention first, then work in progress, then the queue; newest first inside each group. */
  const groups = () =>
    [
      { label: 'Требуют внимания', tasks: attention() },
      { label: 'Скачиваются', tasks: running() },
      { label: 'На паузе', tasks: held() },
      { label: 'В очереди', tasks: waiting() },
    ]
      // Newest first where the newest matters (errors, what is running); the waiting line keeps
      // its order so the first row is the next to start.
      .map((group) => ({
        ...group,
        tasks:
          group.label === 'На паузе' || group.label === 'В очереди'
            ? group.tasks
            : [...group.tasks].reverse(),
      }))
      .filter((group) => group.tasks.length > 0);
  const current = () => [...attention(), ...running(), ...held(), ...waiting()];
  const finished = () =>
    [...tasks()].reverse().filter((task) => !isDownloadActive(task) && !ATTENTION.has(task.state));
  const canCancelAny = () => tasks().some((task) => task.canCancel);
  const overviewMark = (): DownloadProgressMarkState | undefined => {
    if (running().length > 0) return 'running';
    if (held().length > 0) return undefined;
    if (waiting().length > 0) return 'queued';
    return undefined;
  };
  const overviewTitle = (): string => {
    if (running().length > 0) return 'Идёт загрузка';
    if (held().length > 0) return 'Загрузки на паузе';
    if (waiting().length > 0) return online() ? 'Ожидают своей очереди' : 'Ждём сеть';
    if (attention().length > 0) return 'Нужна повторная попытка';
    return 'Все загрузки завершены';
  };
  const overviewMeta = (): string => {
    const parts: string[] = [];
    if (running().length > 0) parts.push(`передач: ${running().length} из 3`);
    if (held().length > 0) parts.push(`на паузе: ${held().length}`);
    if (waiting().length > 0) parts.push(`в очереди: ${waiting().length}`);
    if (attention().length > 0) parts.push(`с ошибкой: ${attention().length}`);
    // Failed work is not transferring; only running and waiting items make up the remaining volume.
    const withSize = [...running(), ...held(), ...waiting()].filter((task) => task.totalBytes);
    if (withSize.length > 0) {
      const done = withSize.reduce((sum, task) => sum + task.downloadedBytes, 0);
      const total = withSize.reduce((sum, task) => sum + (task.totalBytes ?? 0), 0);
      parts.push(`${formatDownloadBytes(done)} из ${formatDownloadBytes(total)}`);
    }
    // Nothing in flight: the title says it all (owner 2026-10-20: less text).
    return parts.join(' · ');
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
                      name={
                        attention().length > 0 ? 'close' : held().length > 0 ? 'pause' : 'check'
                      }
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
                <Show when={overviewMeta()}>
                  {(meta) => <p class="downloads-overview__meta">{meta()}</p>}
                </Show>
              </div>
              <Show when={pause.available()}>
                <DownloadsPauseButton pause={pause} class="downloads-overview__pause" />
              </Show>
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
                  <DownloadTaskList
                    tasks={finished()}
                    onCancel={cancel}
                    onRetry={retry}
                    limit={20}
                  />
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
                      <DownloadTaskList tasks={group.tasks} onCancel={cancel} onRetry={retry} />
                    </section>
                  )}
                </For>
              </Show>
            </Show>
            {/* Keeps the last row clear of the floating bottom navigation. */}
            <div class="downloads-end" aria-hidden="true" />
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
