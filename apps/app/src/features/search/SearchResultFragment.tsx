import type { SearchResult } from '@localmed/contracts';
import { createSignal, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { HighlightedText } from '@/components/HighlightedText';
import { createLineClamp } from '@/components/line-clamp';
import { presentResultSnippet } from '@/features/search/search-result-presentation';
import '@/features/search/search-result-fragment.css';

const FRAGMENT_LINES = 3;
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
  const [text, setText] = createSignal<HTMLParagraphElement>();
  const snippet = () => presentResultSnippet(props.result);
  const clamp = createLineClamp({ element: text, visibleLines: FRAGMENT_LINES, track: snippet });

  const toggle = (): void => {
    const element = text();
    if (!element) return;
    const from = element.getBoundingClientRect().height;
    clamp.toggle();
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
          ref={setText}
          class="result-snippet result-fragment__text"
          classList={{
            'result-fragment__text--collapsed': clamp.folded(),
            'result-fragment__text--cut': clamp.folded(),
          }}
        >
          <HighlightedText text={snippet().text} ranges={snippet().ranges} />
        </p>
      </button>
      <Show when={clamp.foldable()}>
        <button
          class="result-fragment__toggle"
          type="button"
          aria-expanded={clamp.expanded()}
          aria-label={clamp.expanded() ? 'Свернуть фрагмент' : 'Показать фрагмент полностью'}
          onClick={toggle}
        >
          <AppGlyph
            name="caret-down"
            class={`result-fragment__toggle-icon${clamp.expanded() ? ' result-fragment__toggle-icon--open' : ''}`}
          />
        </button>
      </Show>
    </article>
  );
}
