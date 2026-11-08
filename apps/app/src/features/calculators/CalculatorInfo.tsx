import { For, type JSX } from 'solid-js';

import { type HelpSource, HelpSources } from '@/components/HelpSources';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { AvailableCalculatorDefinition } from '@/features/calculators/calculator-types';

/** Population and limits of a calculator: for whom it is and where its numbers stop. */
export function CalculatorSourcesBody(props: {
  readonly definition: AvailableCalculatorDefinition;
}): JSX.Element {
  return (
    <>
      <p>{props.definition.population}</p>
      <ul>
        <For each={props.definition.limitations}>{(limitation) => <li>{limitation}</li>}</For>
      </ul>
    </>
  );
}

/** A calculator's sources as the shared «Источники» list shows them (named, opened in the app). */
export function calculatorHelpSources(
  definition: AvailableCalculatorDefinition,
): readonly HelpSource[] {
  return definition.sources.map((source) => ({
    title: source.title,
    publisher: source.publisher,
    year: source.version,
    ...(source.page ? { detail: source.page } : {}),
    ...(source.url ? { url: source.url } : {}),
    ...(source.document ? { document: source.document } : {}),
  }));
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
      <HelpSources sources={calculatorHelpSources(props.definition)} />
    </OverlayDialog>
  );
}
