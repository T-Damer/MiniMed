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
      <HorizontalScroller class="example-scroll">
        <div class="example-scroll-content">
          <For each={props.examples}>
            {(example, index) => (
              <button type="button" onClick={() => props.onSelect(example)}>
                <span>{String(index() + 1).padStart(2, '0')}</span>
                {example}
              </button>
            )}
          </For>
        </div>
      </HorizontalScroller>
    </fieldset>
  );
}
