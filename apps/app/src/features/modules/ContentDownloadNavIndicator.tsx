import { createSignal, type JSX, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { aggregateDownloadFraction, isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { useDownloadsPause } from '@/features/downloads/use-downloads-pause';
import { downloadNavPieBackground } from '@/features/modules/content-download-progress';
import { SETTINGS_DOWNLOADS_HASH } from '@/features/settings/settings-routing';

export function ContentDownloadNavIndicator(): JSX.Element {
  const queue = getDownloadQueue();
  const pause = useDownloadsPause();
  const [tasks, setTasks] = createSignal(queue.list());
  onMount(() => {
    setTasks(queue.list());
    onCleanup(queue.subscribe(() => setTasks(queue.list())));
  });
  const active = () => tasks().filter(isDownloadActive);
  const attention = () =>
    tasks().some((task) => task.state === 'failed' || task.state === 'interrupted');
  const progress = () => aggregateDownloadFraction(tasks());
  // Queued or retrying work is waiting, not progressing: a clock instead of a frozen pie.
  const waiting = () =>
    !attention() &&
    !active().some(
      (task) =>
        task.state === 'downloading' || task.state === 'verifying' || task.state === 'installing',
    );
  const held = () => pause.paused() && active().some((task) => task.state === 'paused');
  const label = () =>
    `Загрузки: ${active().length}${held() ? ', на паузе' : waiting() ? ', в очереди' : progress() === null ? '' : `, ${Math.floor((progress() ?? 0) * 100)}%`}${attention() ? '. Есть прерванные задания' : ''}. Открыть загрузки`;
  return (
    <Show when={active().length > 0 || attention()}>
      <div class="content-download-nav">
        <Show when={pause.available()}>
          <button
            type="button"
            class="content-download-nav__toggle"
            data-testid="content-download-nav-toggle"
            title={pause.paused() ? 'Продолжить загрузки' : 'Приостановить загрузки'}
            aria-label={pause.paused() ? 'Продолжить загрузки' : 'Приостановить загрузки'}
            onClick={(event) => {
              event.stopPropagation();
              pause.toggle();
            }}
          >
            <Switch>
              <Match when={pause.paused()}>
                <AppGlyph name="play" class="content-download-nav__toggle-glyph" />
              </Match>
              <Match when={!pause.paused()}>
                <AppGlyph name="pause" class="content-download-nav__toggle-glyph" />
              </Match>
            </Switch>
          </button>
        </Show>
        <button
          type="button"
          class="content-download-nav__pie"
          classList={{ 'content-download-nav__pie--waiting': waiting() }}
          style={
            waiting()
              ? undefined
              : {
                  'background-image': downloadNavPieBackground(progress() ?? 0.08, attention()),
                }
          }
          data-testid="content-download-nav"
          title={label()}
          aria-label={label()}
          onClick={(event) => {
            event.stopPropagation();
            window.location.hash = SETTINGS_DOWNLOADS_HASH;
          }}
        >
          <Show when={waiting()}>
            <AppGlyph name={held() ? 'pause' : 'clock'} class="content-download-nav__glyph" />
          </Show>
        </button>
      </div>
    </Show>
  );
}
