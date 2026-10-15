import { type JSX, Show } from 'solid-js';

import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  type SearchCoreStatus,
  searchCoreStatusDetail,
} from '@/features/search/search-core-status';
import { sectionWaitMark, sectionWaitMessage } from '@/features/search/search-section-gate';

import './search-sections.css';

/**
 * The one loading state of a section page: while the core downloads or opens it says so and shows
 * the real download share; once the core is ready and only the list is being read it says that.
 * The finished catalog replaces it in place. Retry and download actions stay in the search block's
 * own status line above, so nothing is offered twice.
 */
export function SearchSectionWait(props: {
  /** The core's status, undefined once the core is ready. */
  readonly status: SearchCoreStatus | undefined;
}): JSX.Element {
  const mark = () => sectionWaitMark(props.status);
  return (
    <div class="search-section-wait" role="status" aria-live="polite">
      <DownloadProgressMark
        class="search-section-wait__mark"
        state={mark().state}
        progress={mark().progress}
        busy={mark().busy}
      />
      <p class="search-section-wait__copy">
        <strong class="search-section-wait__title">
          {props.status ? sectionWaitMessage(props.status) : 'Открываем раздел…'}
        </strong>
        <Show when={props.status}>
          {(status) => (
            <span class="search-section-wait__detail">{searchCoreStatusDetail(status())}</span>
          )}
        </Show>
      </p>
    </div>
  );
}
