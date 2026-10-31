import { For, type JSX, onCleanup, onMount } from 'solid-js';

import { holdReaderChrome } from '@/state/reader-chrome-hold';

import './page-skeleton.css';

/** How long one «keep the controls shown» request lasts; renewed while the lines stay visible. */
const CHROME_HOLD_MS = 1000;

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
  let element: HTMLDivElement | undefined;
  // Never a lone loader (AGENTS.md): while these lines are on screen the reader's controls stay
  // in view, even when the reader had scrolled them away before the text started loading.
  onMount(() => {
    if (!element || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | undefined;
    // On screen as it mounts: ask at once, before the observer's first report a frame later.
    const box = element.getBoundingClientRect();
    if (box.bottom > 0 && box.top < window.innerHeight) holdReaderChrome(CHROME_HOLD_MS);
    const stop = (): void => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) {
        stop();
        return;
      }
      if (timer !== undefined) return;
      holdReaderChrome(CHROME_HOLD_MS);
      timer = setInterval(() => holdReaderChrome(CHROME_HOLD_MS), CHROME_HOLD_MS - 200);
    });
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      stop();
    });
  });
  return (
    <div
      ref={element}
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
