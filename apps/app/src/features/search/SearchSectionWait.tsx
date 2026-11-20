import { type JSX, Show } from 'solid-js';

import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import type { InstalledMountProgress } from '@/features/modules/browser-module-runtime';
import { SearchCoreStatusNote } from '@/features/search/SearchCoreStatusNote';
import {
  type SearchCoreStatus,
  searchCoreStatusDetail,
} from '@/features/search/search-core-status';
import { sectionWaitMark, sectionWaitMessage } from '@/features/search/search-section-gate';

import './search-sections.css';

/**
 * The one loading state of a section page: while the core downloads or opens it says so and shows
 * the real download share; once the core is ready and only the list is being read it says that.
 * The finished catalog replaces it in place.
 */
export function SearchSectionWait(props: {
  /** The core's status, undefined once the core is ready. */
  readonly status: SearchCoreStatus | undefined;
  readonly installedProgress?: InstalledMountProgress | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly onDownload?: (() => void) | undefined;
}): JSX.Element {
  const mark = () => sectionWaitMark(props.status);
  const actionStatus = () => {
    const status = props.status;
    return status?.kind === 'error' ||
      status?.kind === 'download-required' ||
      status?.kind === 'other-tab'
      ? status
      : undefined;
  };
  return (
    <Show
      when={actionStatus()}
      fallback={
        <div class="search-section-wait" role="status" aria-live="polite">
          <DownloadProgressMark
            class="search-section-wait__mark"
            state={mark().state}
            progress={mark().progress}
            busy={mark().busy}
          />
          <p class="search-section-wait__copy">
            <strong class="search-section-wait__title">Открываем раздел…</strong>
            <Show
              when={props.installedProgress}
              fallback={
                <Show when={props.status}>
                  {(status) => (
                    <span class="search-section-wait__detail">
                      {searchCoreStatusDetail(status()) || sectionWaitMessage(status())}
                    </span>
                  )}
                </Show>
              }
            >
              {(progress) => (
                <>
                  <span class="search-section-wait__detail">
                    Подключаем локальные наборы · {progress().processed} / {progress().total}
                  </span>
                  <progress
                    class="search-core-status__progress"
                    aria-label="Подключение локальных наборов"
                    value={progress().processed}
                    max={progress().total}
                  />
                </>
              )}
            </Show>
          </p>
        </div>
      }
    >
      {(status) => (
        <SearchCoreStatusNote
          status={status()}
          {...(props.onRetry ? { onRetry: props.onRetry } : {})}
          {...(props.onDownload ? { onDownload: props.onDownload } : {})}
        />
      )}
    </Show>
  );
}
