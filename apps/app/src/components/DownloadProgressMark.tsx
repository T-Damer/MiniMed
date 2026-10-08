import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

import '@/components/DownloadProgressMark.css';

export type DownloadProgressMarkState = 'queued' | 'running' | 'failed' | 'done';

/**
 * One download status mark: a clock while work only waits in the queue, a check once it is done,
 * otherwise a round progress pie that keeps its size however tight the surrounding row is.
 */
export function DownloadProgressMark(props: {
  readonly state: DownloadProgressMarkState;
  /** 0–1, or null while the total size is unknown. */
  readonly progress: number | null;
  /** The work has no measurable progress right now (connecting, installing): the pie turns. */
  readonly busy?: boolean;
  readonly class?: string;
}): JSX.Element {
  const degrees = () => Math.round(Math.max(0, Math.min(1, props.progress ?? 0.08)) * 360);
  const glyph = (): 'clock' | 'check' => (props.state === 'done' ? 'check' : 'clock');
  return (
    <Show
      when={props.state !== 'queued' && props.state !== 'done'}
      fallback={
        <span
          class={`download-progress-mark ${props.state === 'done' ? 'download-progress-mark--done' : 'download-progress-mark--queued'} ${props.class ?? ''}`.trim()}
          aria-hidden="true"
        >
          <AppGlyph name={glyph()} class="download-progress-mark__glyph" />
        </span>
      }
    >
      <span
        class={`download-progress-mark ${props.class ?? ''}`.trim()}
        classList={{
          'download-progress-mark--failed': props.state === 'failed',
          'download-progress-mark--busy': props.busy === true,
        }}
        style={{ '--download-progress-mark-degrees': `${degrees()}deg` }}
        aria-hidden="true"
      />
    </Show>
  );
}
