import { For, type JSX } from 'solid-js';

import { HorizontalScroller } from '@/components/HorizontalScroller';

interface SearchExamplesProps {
  readonly examples: readonly string[];
  readonly onSelect: (example: string) => void;
}

export function SearchExamples(props: SearchExamplesProps): JSX.Element {
  return (
    <fieldset class="example-row">
      <legend>Примеры поиска</legend>
      <HorizontalScroller
        class="example-scroll"
        viewportClass="example-scroll__viewport"
        controls
        hideScrollbar
        controlLabel="примеры"
      >
        <div class="example-scroll-content">
          <For each={props.examples}>
            {(example, index) => (
              <button
                type="button"
                class="example-scroll-content__chip"
                onClick={() => props.onSelect(example)}
              >
                <span class="example-scroll-content__chip-index">
                  {String(index() + 1).padStart(2, '0')}
                </span>
                {example}
              </button>
            )}
          </For>
        </div>
      </HorizontalScroller>
    </fieldset>
  );
}
