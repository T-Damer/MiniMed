import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

import '@/components/DownloadProgressMark.css';

export type DownloadProgressMarkState = 'queued' | 'running' | 'failed';

/**
 * One download status mark: a clock while work only waits in the queue, otherwise a round
 * progress pie that keeps its size however tight the surrounding row is.
 */
export function DownloadProgressMark(props: {
  readonly state: DownloadProgressMarkState;
  /** 0–1, or null while the total size is unknown. */
  readonly progress: number | null;
  readonly class?: string;
}): JSX.Element {
  const degrees = () => Math.round(Math.max(0, Math.min(1, props.progress ?? 0.08)) * 360);
  return (
    <Show
      when={props.state !== 'queued'}
      fallback={
        <span
          class={`download-progress-mark download-progress-mark--queued ${props.class ?? ''}`.trim()}
          aria-hidden="true"
        >
          <AppGlyph name="clock" class="download-progress-mark__glyph" />
        </span>
      }
    >
      <span
        class={`download-progress-mark ${props.class ?? ''}`.trim()}
        classList={{ 'download-progress-mark--failed': props.state === 'failed' }}
        style={{ '--download-progress-mark-degrees': `${degrees()}deg` }}
        aria-hidden="true"
      />
    </Show>
  );
}
