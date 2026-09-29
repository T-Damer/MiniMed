import { createSignal, type JSX, onCleanup, Show } from 'solid-js';

import { SearchCoreStatusNote } from '@/features/search/SearchCoreStatusNote';
import {
  SEARCH_CORE_NOTE_DELAY_MS,
  type SearchCoreStatus,
  searchCoreStatusNoteVisible,
} from '@/features/search/search-core-status';

import './document-core-wait.css';

/**
 * A document link opened before the medical core is ready: the page says why the document waits
 * instead of staying blank. A quick open shows nothing for the same short delay as the search
 * field, so a fast start never flashes a status.
 */
export function DocumentCoreWait(props: {
  readonly status: SearchCoreStatus | undefined;
  readonly onRetry: () => void;
  readonly onDownload: () => void;
}): JSX.Element {
  const [delayPassed, setDelayPassed] = createSignal(false);
  const timer = window.setTimeout(() => setDelayPassed(true), SEARCH_CORE_NOTE_DELAY_MS);
  onCleanup(() => window.clearTimeout(timer));
  const visibleStatus = (): SearchCoreStatus | undefined =>
    props.status && searchCoreStatusNoteVisible(props.status, delayPassed())
      ? props.status
      : undefined;
  return (
    <div class="document-core-wait page-surface page-grain" aria-busy="true">
      <Show when={visibleStatus()}>
        {(status) => (
          <div class="document-core-wait__note">
            <p class="document-core-wait__title">Документ откроется, когда база будет готова</p>
            <SearchCoreStatusNote
              status={status()}
              onRetry={props.onRetry}
              onDownload={props.onDownload}
            />
          </div>
        )}
      </Show>
    </div>
  );
}
