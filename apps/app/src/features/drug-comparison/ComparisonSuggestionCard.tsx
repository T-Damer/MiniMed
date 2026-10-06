import type { MedicalCore } from '@localmed/contracts';
import { createResource, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { notesDrugComparisonPath } from '@/features/notes/notes-routing';
import { encodeDrug, type FoundDrug, resolveDrugName } from './comparison-candidates';
import '@/styles/comparison-suggestion.css';

/** The drugs a parsed comparison query names, or null unless at least two of them are drugs. */
async function resolveNames(
  core: MedicalCore,
  names: readonly string[],
): Promise<readonly FoundDrug[] | null> {
  const found = await Promise.all(names.map((name) => resolveDrugName(core, name)));
  const drugs: FoundDrug[] = [];
  for (const drug of found) {
    if (drug && !drugs.some((entry) => encodeDrug(entry) === encodeDrug(drug))) drugs.push(drug);
  }
  return drugs.length >= 2 && drugs.length === names.length ? drugs : null;
}

/**
 * The card at the top of the results of a query that compares drugs («ибупрофен или парацетамол»,
 * «чем отличается X от Y»): it opens the comparison tool with those drugs. It appears only when
 * every part of the query names a drug in the ordinary drug search, so a disease or a symptom
 * («менингит или энцефалит») gets no card. The results below are unchanged.
 */
export function ComparisonSuggestionCard(props: {
  readonly core: MedicalCore | undefined;
  readonly names: readonly string[];
}): JSX.Element {
  const [drugs] = createResource(
    () => (props.core ? { core: props.core, names: props.names } : undefined),
    (source) => resolveNames(source.core, source.names).catch(() => null),
  );
  return (
    <Show when={drugs()}>
      {(found) => (
        <a
          class="comparison-suggestion paper-card"
          href={notesDrugComparisonPath([], found().map(encodeDrug))}
          data-testid="comparison-suggestion"
        >
          <AppGlyph name="pill" class="comparison-suggestion__icon" />
          <span class="comparison-suggestion__copy">
            <span class="comparison-suggestion__title">
              Сравнить:{' '}
              <For each={found()}>
                {(drug, position) => (
                  <>
                    {position() > 0 ? ', ' : ''}
                    <span class="comparison-suggestion__name">{drug.label}</span>
                  </>
                )}
              </For>
            </span>
            <span class="comparison-suggestion__hint">
              Сравнение текстов инструкций, а не клиническая рекомендация: реестровые данные и
              разделы инструкций рядом, с пометками «у обоих» и «у других совпадения нет».
            </span>
          </span>
          <AppGlyph name="caret-right" class="comparison-suggestion__chevron" />
        </a>
      )}
    </Show>
  );
}
