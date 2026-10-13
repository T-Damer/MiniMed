import { For, type JSX, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import type { AvailableCalculatorDefinition } from '@/features/calculators/calculator-types';

/** Population, limits and sources of a calculator: where its numbers come from and for whom. */
export function CalculatorSourcesBody(props: {
  readonly definition: AvailableCalculatorDefinition;
}): JSX.Element {
  return (
    <>
      <p>{props.definition.population}</p>
      <ul>
        <For each={props.definition.limitations}>{(limitation) => <li>{limitation}</li>}</For>
      </ul>
      <For each={props.definition.sources}>
        {(source) => (
          <p class="calculator-source-reference">
            <Show
              when={source.url}
              fallback={<span class="calculator-source-reference__title">{source.title}</span>}
            >
              <a
                class="calculator-source-reference__link"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.title}
              </a>
            </Show>{' '}
            · {source.publisher} · {source.version} · проверено {source.reviewedAt}
          </p>
        )}
      </For>
    </>
  );
}

/** The «Информация» item of a calculator's menu. */
export function CalculatorInfoDialog(props: {
  readonly definition: AvailableCalculatorDefinition;
  readonly open: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <OverlayDialog open={props.open} title="Информация" onClose={props.onClose}>
      <p>{props.definition.summary}</p>
      <CalculatorSourcesBody definition={props.definition} />
    </OverlayDialog>
  );
}

/** One line for the foot of the page; the full list is in «Информация». */
export function calculatorSourcesFootnote(definition: AvailableCalculatorDefinition): string {
  const shown = definition.sources
    .slice(0, 2)
    .map((source) => `${source.title} (${source.publisher}, ${source.version})`);
  const rest = definition.sources.length - shown.length;
  if (shown.length === 0) return '';
  return `Источники: ${shown.join('; ')}${rest > 0 ? ` и ещё ${rest}` : ''}.`;
}
