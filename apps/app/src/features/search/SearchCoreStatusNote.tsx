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

/**
 * The medical core is not ready yet. `card` stands on its own (reader, knowledge base); `inline`
 * is one small line at the bottom of the search block, whose field stays usable meanwhile.
 */
export function SearchCoreStatusNote(props: {
  readonly status: SearchCoreStatus;
  readonly variant?: 'card' | 'inline';
  readonly onRetry?: () => void;
  readonly onDownload?: () => void;
}): JSX.Element {
  const failed = () => props.status.kind === 'error';
  const inline = () => props.variant === 'inline';
  return (
    <div
      class="search-core-status"
      classList={{
        'search-core-status--error': failed(),
        'search-core-status--inline': inline(),
      }}
      role={failed() ? 'alert' : 'status'}
      aria-live={failed() ? undefined : 'polite'}
    >
      {/* Motion means measurable work: the pie fills with the real download share. Phases with no
          measurable share, and waiting, show a still mark — never an endless spinner. */}
      <Show when={!inline()}>
        <Switch
          fallback={
            <DownloadProgressMark class="search-core-status__mark" state="queued" progress={null} />
          }
        >
          <Match when={props.status.kind === 'downloading'}>
            <DownloadProgressMark
              class="search-core-status__mark"
              state="running"
              progress={searchCoreProgress(props.status)}
            />
          </Match>
          <Match when={props.status.kind === 'verifying' || props.status.kind === 'installing'}>
            {/* The file is complete; checking and installing it have no share to measure. */}
            <DownloadProgressMark class="search-core-status__mark" state="running" progress={1} />
          </Match>
          <Match when={failed()}>
            <DownloadProgressMark class="search-core-status__mark" state="failed" progress={1} />
          </Match>
        </Switch>
      </Show>
      <p
        class="search-core-status__copy"
        classList={{ 'search-core-status__copy--inline': inline() }}
      >
        <strong
          class="search-core-status__title"
          classList={{ 'search-core-status__title--inline': inline() }}
        >
          {searchCoreStatusLabel(props.status)}
        </strong>
        <span
          class="search-core-status__detail"
          classList={{ 'search-core-status__detail--inline': inline() }}
        >
          {searchCoreStatusDetail(props.status)}
        </span>
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
