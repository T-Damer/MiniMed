import { type JSX, Match, Show, Switch } from 'solid-js';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import { CORE_DOWNLOAD_SIZE_LABEL } from '@/composition/core-download';
import {
  type SearchCoreStatus,
  searchCoreProgress,
  searchCoreStatusDetail,
  searchCoreStatusLabel,
} from '@/features/search/search-core-status';

/** Compact line under the disabled search field while the medical core is not ready. */
export function SearchCoreStatusNote(props: {
  readonly status: SearchCoreStatus;
  readonly onRetry?: () => void;
  readonly onDownload?: () => void;
}): JSX.Element {
  const failed = () => props.status.kind === 'error';
  return (
    <div
      class="search-core-status"
      classList={{ 'search-core-status--error': failed() }}
      role={failed() ? 'alert' : 'status'}
      aria-live={failed() ? undefined : 'polite'}
    >
      <Switch fallback={<span class="search-core-status__spinner" aria-hidden="true" />}>
        <Match when={props.status.kind === 'downloading'}>
          <DownloadProgressMark
            class="search-core-status__mark"
            state="running"
            progress={searchCoreProgress(props.status)}
          />
        </Match>
        <Match when={props.status.kind === 'other-tab'}>
          <DownloadProgressMark class="search-core-status__mark" state="queued" progress={null} />
        </Match>
        <Match when={failed()}>
          <DownloadProgressMark class="search-core-status__mark" state="failed" progress={1} />
        </Match>
      </Switch>
      <p class="search-core-status__copy">
        <strong class="search-core-status__title">{searchCoreStatusLabel(props.status)}</strong>
        <span class="search-core-status__detail">{searchCoreStatusDetail(props.status)}</span>
      </p>
      <Show when={failed() && props.onRetry}>
        {(retry) => (
          <Button class="search-core-status__action" variant="secondary" onClick={() => retry()()}>
            Повторить
          </Button>
        )}
      </Show>
      <Show when={props.status.kind === 'download-required' && props.onDownload}>
        {(download) => (
          <Button class="search-core-status__action" variant="primary" onClick={() => download()()}>
            Скачать ядро · ~{CORE_DOWNLOAD_SIZE_LABEL}
          </Button>
        )}
      </Show>
    </div>
  );
}
