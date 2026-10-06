import { For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { notesDrugInteractionsPath } from '@/features/notes/notes-routing';
import '@/styles/interaction-suggestion.css';

/**
 * The card at the top of the results of a query that asks about drugs taken together («варфарин
 * взаимодействие с ибупрофеном»): it opens the interaction tool with those drugs. It only repeats
 * the names the doctor typed; the tool looks them up.
 */
export function InteractionSuggestionCard(props: {
  readonly names: readonly string[];
}): JSX.Element {
  return (
    <a
      class="interaction-suggestion paper-card"
      href={notesDrugInteractionsPath(props.names)}
      data-testid="interaction-suggestion"
    >
      <AppGlyph name="pill" class="interaction-suggestion__icon" />
      <span class="interaction-suggestion__copy">
        <span class="interaction-suggestion__title">
          Проверить взаимодействие:{' '}
          <For each={props.names}>
            {(name, position) => (
              <>
                {position() > 0 ? ', ' : ''}
                <span class="interaction-suggestion__name">{name}</span>
              </>
            )}
          </For>
        </span>
        <span class="interaction-suggestion__hint">
          Предложения из официальных инструкций, где один препарат упоминает другой. Это поиск по
          текстам, а не оценка безопасности.
        </span>
      </span>
      <AppGlyph name="caret-right" class="interaction-suggestion__chevron" />
    </a>
  );
}
