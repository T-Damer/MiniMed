import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { aggregateDownloadFraction, isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { downloadNavPieBackground } from '@/features/modules/content-download-progress';
import { SETTINGS_DOWNLOADS_HASH } from '@/features/settings/settings-routing';

export function ContentDownloadNavIndicator(): JSX.Element {
  const queue = getDownloadQueue();
  const [tasks, setTasks] = createSignal(queue.list());
  onMount(() => {
    setTasks(queue.list());
    onCleanup(queue.subscribe(() => setTasks(queue.list())));
  });
  const active = () => tasks().filter(isDownloadActive);
  const attention = () =>
    tasks().some((task) => task.state === 'failed' || task.state === 'interrupted');
  const progress = () => aggregateDownloadFraction(tasks());
  const label = () =>
    `Загрузки: ${active().length}${progress() === null ? '' : `, ${Math.floor((progress() ?? 0) * 100)}%`}${attention() ? '. Есть прерванные задания' : ''}. Открыть загрузки`;
  return (
    <Show when={active().length > 0 || attention()}>
      <div class="content-download-nav">
        <button
          type="button"
          class="content-download-nav__pie"
          style={{ background: downloadNavPieBackground(progress() ?? 0.08, attention()) }}
          data-testid="content-download-nav"
          title={label()}
          aria-label={label()}
          onClick={(event) => {
            event.stopPropagation();
            window.location.hash = SETTINGS_DOWNLOADS_HASH;
          }}
        />
      </div>
    </Show>
  );
}
