import type { SearchResult } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { HighlightedText } from '@/components/HighlightedText';
import { presentResultSnippet } from '@/features/search/search-result-presentation';
import '@/features/search/search-result-fragment.css';

const EXPAND_MS = 240;
const EXPAND_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * One found part of a document: its text is three lines at first, a quiet fade where it goes on,
 * and a chevron that unrolls the rest in place (the card grows like an iOS disclosure). Tapping
 * the text itself opens the source at this part.
 */
export function SearchResultFragment(props: {
  readonly result: SearchResult;
  readonly selected: boolean;
  readonly onOpen: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  let text: HTMLParagraphElement | undefined;
  let frame = 0;
  const snippet = () => presentResultSnippet(props.result);

  const measure = (): void => {
    frame = 0;
    // Only a collapsed text can tell whether it is cut: an open one shows everything.
    if (text && !expanded()) setOverflowing(text.scrollHeight > text.clientHeight + 1);
  };
  const scheduleMeasure = (): void => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  onMount(() => {
    measure();
    // A late web font can add a line without resizing the clamped box.
    void document.fonts?.ready.then(scheduleMeasure);
    if (!text) return;
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(text);
    onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    });
  });

  const toggle = (): void => {
    const element = text;
    if (!element) return;
    const from = element.getBoundingClientRect().height;
    setExpanded(!expanded());
    const to = element.getBoundingClientRect().height;
    if (Math.abs(from - to) < 1) return;
    element.animate([{ maxHeight: `${from}px` }, { maxHeight: `${to}px` }], {
      duration: EXPAND_MS,
      easing: EXPAND_EASE,
    });
  };

  return (
    <article
      class="result-card result-fragment"
      classList={{ 'result-card--selected': props.selected }}
    >
      <button
        class="result-open result-fragment__open"
        type="button"
        data-testid="search-result"
        onClick={() => props.onOpen()}
      >
        <p
          ref={text}
          class="result-snippet result-fragment__text"
          classList={{
            'result-fragment__text--collapsed': !expanded(),
            'result-fragment__text--cut': !expanded() && overflowing(),
          }}
        >
          <HighlightedText text={snippet().text} ranges={snippet().ranges} />
        </p>
      </button>
      <Show when={overflowing() || expanded()}>
        <button
          class="result-fragment__toggle"
          type="button"
          aria-expanded={expanded()}
          aria-label={expanded() ? 'Свернуть фрагмент' : 'Показать фрагмент полностью'}
          onClick={toggle}
        >
          <AppGlyph
            name="caret-down"
            class={`result-fragment__toggle-icon${expanded() ? ' result-fragment__toggle-icon--open' : ''}`}
          />
        </button>
      </Show>
    </article>
  );
}
