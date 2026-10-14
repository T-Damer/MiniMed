import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ScrollStripArrows } from '@/components/ScrollStripArrows';
import type { AvailableCalculatorDefinition } from '@/features/calculators/calculator-types';

/** The calculators opened last, as one compact row of chips at the top of the calculators list. */
export function RecentCalculatorsRow(props: {
  readonly calculators: readonly AvailableCalculatorDefinition[];
  readonly onOpen: (definition: AvailableCalculatorDefinition) => void;
}): JSX.Element {
  const [strip, setStrip] = createSignal<HTMLElement>();
  return (
    <Show when={props.calculators.length > 0}>
      <nav
        class="recent-calculators"
        aria-label="Недавние калькуляторы"
        data-testid="recent-calculators"
      >
        <AppGlyph name="clock" class="recent-calculators__icon" />
        <div class="scroll-strip">
          <ul ref={setStrip} class="recent-calculators__list">
            <For each={props.calculators}>
              {(definition) => (
                <li class="recent-calculators__item">
                  <button
                    type="button"
                    class="recent-calculators__chip"
                    title={definition.title}
                    data-testid={`recent-calculator-${definition.id}`}
                    onClick={() => props.onOpen(definition)}
                  >
                    {definition.shortTitle}
                  </button>
                </li>
              )}
            </For>
          </ul>
          <ScrollStripArrows target={strip} label="калькуляторы" />
        </div>
      </nav>
    </Show>
  );
}
