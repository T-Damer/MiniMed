import type { MedicalCore } from '@localmed/contracts';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SearchField } from '@/components/SearchField';
import { DrugCatalogOffer } from '@/features/drug-interactions/DrugCatalogOffer';
import { AtcMatchBadge } from '@/features/medications/AtcMatchBadge';
import { type DoseCandidate, findDoseCandidates } from './dose-candidates';
import type { DoseIndex } from './dose-index';
import '@/styles/prescription.css';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The drug field of the prescription tool: suggestions follow the typing after a short pause, from
 * the app's own medication search; a name that finds nothing offers the medication download in
 * place. Picking a suggestion hands the drug over and clears the field.
 */
export function PrescriptionDrugSlot(props: {
  readonly core: MedicalCore | undefined;
  readonly index: DoseIndex | undefined;
  readonly placeholder: string;
  readonly taken: (slug: string) => boolean;
  readonly focusOnMount?: boolean;
  readonly onPick: (candidate: DoseCandidate) => void;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [suggestions, setSuggestions] = createSignal<readonly DoseCandidate[]>([]);
  const [settledFor, setSettledFor] = createSignal('');
  let input: HTMLInputElement | undefined;

  onMount(() => {
    if (props.focusOnMount) input?.focus({ preventScroll: true });
  });

  createEffect(() => {
    const text = query().trim();
    const loaded = props.index;
    const core = props.core;
    if (text.length < 2 || !loaded || !core) {
      setSuggestions([]);
      setSettledFor('');
      return;
    }
    const handle = setTimeout(() => {
      void findDoseCandidates(core, loaded, text).then((found) => {
        if (untrack(() => query().trim()) !== text) return;
        setSuggestions(found);
        setSettledFor(text);
      });
    }, SEARCH_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(handle));
  });

  const clear = (): void => {
    setQuery('');
    setSuggestions([]);
    setSettledFor('');
  };
  const nothingFound = (): boolean =>
    settledFor() !== '' && settledFor() === query().trim() && suggestions().length === 0;

  return (
    <div class="prescription__slot">
      <SearchField
        class="prescription__search"
        label="Препарат"
        hideLabel
        placeholder={props.placeholder}
        value={query()}
        inputRef={(element) => {
          input = element;
        }}
        onInput={setQuery}
        onClear={clear}
      />
      <Show when={suggestions().length > 0}>
        <ul class="prescription__candidates" aria-label="Найденные препараты">
          <For each={suggestions()}>
            {(candidate) => (
              <li class="prescription__candidate-row">
                <button
                  type="button"
                  class="prescription__candidate"
                  data-testid="prescription-candidate"
                  disabled={props.taken(candidate.slug)}
                  onClick={() => {
                    clear();
                    props.onPick(candidate);
                  }}
                >
                  <AppGlyph name={props.taken(candidate.slug) ? 'check' : 'plus'} />
                  <span class="prescription__candidate-name">{candidate.label}</span>
                  <Show when={candidate.atc}>{(match) => <AtcMatchBadge match={match()} />}</Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={nothingFound()}>
        <div class="prescription__nothing" role="status">
          <span class="prescription__hint">Ничего не найдено.</span>
          <DrugCatalogOffer onContentChanged={props.onContentChanged} />
        </div>
      </Show>
    </div>
  );
}
