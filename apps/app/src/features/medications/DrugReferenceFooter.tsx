import { type JSX, Show } from 'solid-js';

import {
  type InstructionSourceInfo,
  instructionSourceName,
} from '@/features/medications/instruction-source';

import '@/features/medications/drug-screen.css';

/**
 * Where the drug screen's facts and text come from, as small plain text at the very end: the
 * registers behind the card, and the kind, edition, publisher and fetch date of the official text.
 * Reference data, so it never stands between the doctor and the instruction.
 */
export function DrugReferenceFooter(props: {
  readonly sources: readonly string[];
  readonly instruction: InstructionSourceInfo | null;
}): JSX.Element {
  return (
    <Show when={props.sources.length > 0 || props.instruction}>
      <footer class="drug-reference">
        <Show when={props.sources.length > 0}>
          <p class="drug-reference__line">Источник: {props.sources.join(' · ')}</p>
        </Show>
        <Show when={props.instruction}>
          {(info) => (
            <p class="drug-reference__line">
              Текст: {info().kindLabel}
              <Show when={info().edition}>{(edition) => <> · {edition()}</>}</Show>
              {' · '}
              <Show when={info().sourceUrl} fallback={instructionSourceName(info())}>
                {(url) => (
                  <a class="drug-reference__link" href={url()} rel="noreferrer" target="_blank">
                    {instructionSourceName(info())}
                  </a>
                )}
              </Show>
              <Show when={info().fetchedOn}>{(date) => <> · получено {date()}</>}</Show>
            </p>
          )}
        </Show>
      </footer>
    </Show>
  );
}
