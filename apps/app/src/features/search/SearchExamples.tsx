import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-solid';
import { For, type JSX } from 'solid-js';

import { translateVerticalWheelToHorizontal } from '@/features/search/horizontal-wheel-scroll';

interface SearchExamplesProps {
  readonly examples: readonly string[];
  readonly onSelect: (example: string) => void;
}

export function SearchExamples(props: SearchExamplesProps): JSX.Element {
  let scroller: OverlayScrollbarsComponentRef | undefined;

  return (
    <fieldset class="example-row">
      <legend>Примеры поиска</legend>
      <OverlayScrollbarsComponent
        ref={(value) => {
          scroller = value;
        }}
        class="example-scroll os-theme-dark"
        options={{
          overflow: { x: 'scroll', y: 'hidden' },
          scrollbars: { autoHide: 'scroll' },
        }}
        defer
        onWheel={(event) => {
          const viewport = scroller?.osInstance()?.elements().viewport;
          if (viewport) translateVerticalWheelToHorizontal(event, viewport);
        }}
      >
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
      </OverlayScrollbarsComponent>
    </fieldset>
  );
}
