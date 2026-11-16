import { createEffect, createSignal, type JSX, on, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import '@/features/search/search-more-below.css';

/** Results count as «below» once this much of the page is under the screen. */
const BELOW_PX = 96;
const MEASURE_INTERVAL_MS = 120;
/** Scrolled this far since the arrow appeared: the reader has seen there is more. */
const NOTICED_PX = 48;

/**
 * The one sign that a search has more than the screen shows (owner 2026-11-16): a round button in
 * the middle of the screen's bottom edge, above the bottom bar and the recording button. While
 * more results are being found it is a spinner; when results lie below it is an arrow that scrolls
 * to them, until the reader scrolls. Results are only ever added under what is shown, so this is where to look for them.
 */
export function SearchMoreBelow(props: {
  /** More results are still being found. */
  readonly pending: boolean;
  /** Changes whenever the list of results does: the button measures the page again. */
  readonly track: () => unknown;
}): JSX.Element {
  const [below, setBelow] = createSignal(false);
  // The arrow is a notice, not a fixture: once the reader has scrolled on their own it goes away,
  // so it does not sit over a control in the middle of the bottom edge, and comes back when the
  // list gets new results.
  const [noticed, setNoticed] = createSignal(false);
  let shownAtTop: number | undefined;
  let timer: number | undefined;
  const measure = (): void => {
    timer = undefined;
    const page = document.scrollingElement;
    if (!page) return;
    const more = page.scrollHeight - page.scrollTop - window.innerHeight > BELOW_PX;
    setBelow(more);
    if (!more) return;
    shownAtTop ??= page.scrollTop;
    if (Math.abs(page.scrollTop - shownAtTop) > NOTICED_PX) setNoticed(true);
  };
  const measureSoon = (): void => {
    timer ??= window.setTimeout(measure, MEASURE_INTERVAL_MS);
  };
  onMount(() => {
    window.addEventListener('scroll', measureSoon, { passive: true });
    window.addEventListener('resize', measureSoon);
    measureSoon();
    onCleanup(() => {
      window.removeEventListener('scroll', measureSoon);
      window.removeEventListener('resize', measureSoon);
      window.clearTimeout(timer);
    });
  });
  createEffect(
    on(props.track, () => {
      setNoticed(false);
      shownAtTop = undefined;
      measureSoon();
    }),
  );

  return (
    <Show when={props.pending || (below() && !noticed())}>
      <button
        type="button"
        class="search-more-below"
        classList={{ 'search-more-below--pending': props.pending }}
        data-testid="search-more-below"
        aria-label={props.pending ? 'Ищем ещё результаты' : 'Ниже есть ещё результаты'}
        aria-busy={props.pending}
        onClick={() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' })}
      >
        <Show
          when={props.pending}
          fallback={<AppGlyph name="caret-down" class="search-more-below__arrow" />}
        >
          <span class="search-more-below__spinner" aria-hidden="true" />
        </Show>
      </button>
    </Show>
  );
}
