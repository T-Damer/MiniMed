import { createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { DownloadTaskRow } from '@/features/downloads/DownloadTaskRow';
import type { DownloadTask } from '@/features/downloads/download-queue';
import { formatCount } from '@/i18n/format-count';

/** A full download of the catalog queues ~840 entries: only the first rows are drawn until asked. */
export const DOWNLOAD_PREVIEW_ROWS = 6;

/**
 * The rows of one group of the queue. Long groups show their first rows and one «Показать все N»
 * button, so the page stays light however many modules are queued; the count in the group heading
 * and the overview card already say how many there are.
 */
export function DownloadTaskList(props: {
  readonly tasks: readonly DownloadTask[];
  readonly onCancel: (task: DownloadTask) => void;
  readonly onRetry: (task: DownloadTask) => void;
  readonly limit?: number;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const limit = (): number => props.limit ?? DOWNLOAD_PREVIEW_ROWS;
  // A few rows beyond the limit are not worth a button: show them.
  const folded = (): boolean => !expanded() && props.tasks.length > limit() + 2;
  const visible = (): readonly DownloadTask[] =>
    folded() ? props.tasks.slice(0, limit()) : props.tasks;
  return (
    <ul class="downloads-group__list paper-card">
      <For each={visible()}>
        {(task) => (
          <DownloadTaskRow task={task} onCancel={props.onCancel} onRetry={props.onRetry} />
        )}
      </For>
      <Show when={folded()}>
        <li class="downloads-group__more">
          <Button
            class="downloads-group__more-button"
            variant="quiet"
            data-testid="downloads-show-all"
            onClick={() => setExpanded(true)}
          >
            Показать все · {formatCount(props.tasks.length)}
          </Button>
        </li>
      </Show>
    </ul>
  );
}
