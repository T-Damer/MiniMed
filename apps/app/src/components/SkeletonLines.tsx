import { For, type JSX } from 'solid-js';

import './page-skeleton.css';

/** Widths (in percent) of the placeholder text lines: ragged, like a paragraph. */
export const LINE_WIDTHS: readonly number[] = [100, 96, 100, 88, 100, 42, 100, 94, 100, 70];

/**
 * Text still on its way inside a page that already shows (the next sections of a long document, a
 * drug card's instruction): a few ragged lines where it will appear, never a lone ring. The page's
 * own header and navigation stay around it (owner 2026-10-26: «show at least something»).
 */
export function SkeletonLines(props: {
  /** What is loading, for assistive tech («Загружаем остальные разделы»). */
  readonly label: string;
  readonly lines?: number;
  readonly class?: string;
}): JSX.Element {
  return (
    <div
      class={`skeleton-lines${props.class ? ` ${props.class}` : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={props.label}
      data-testid="skeleton-lines"
    >
      <For each={LINE_WIDTHS.slice(0, props.lines ?? 4)}>
        {(width) => (
          <span class="page-skeleton__bar" style={{ width: `${width}%` }} aria-hidden="true" />
        )}
      </For>
    </div>
  );
}
