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
import { DrugCatalogOffer } from './DrugCatalogOffer';
import { type DrugCandidate, findDrugCandidates } from './drug-candidates';
import { ALCOHOL_ITEM_ID } from './interaction-check';
import type { InteractionIndex } from './interaction-index';
import '@/styles/drug-interactions.css';

/** What a typed name may stand for: a drug card of the index, or alcohol (found by typing). */
export type DrugSuggestion =
  | { readonly kind: 'drug'; readonly candidate: DrugCandidate }
  | { readonly kind: 'alcohol' };

const SEARCH_DEBOUNCE_MS = 250;
const ALCOHOL_WORD = 'алкоголь';
const ALCOHOL_NAME = /^(?:алкогол|этанол|спирт|вино\b|пиво\b)/iu;

/** «алк», «алкогол», «этанол»: the name of alcohol, not of a drug. */
export function namesAlcohol(text: string): boolean {
  const typed = text.trim().toLocaleLowerCase('ru-RU');
  return ALCOHOL_NAME.test(typed) || (typed.length >= 3 && ALCOHOL_WORD.startsWith(typed));
}

/**
 * One search field of «Взаимодействие препаратов»: suggestions follow the typing after a short
 * pause; a name that finds nothing offers the medication download in place.
 */
export function DrugSlot(props: {
  readonly core: MedicalCore | undefined;
  readonly index: InteractionIndex | undefined;
  readonly label: string;
  readonly placeholder: string;
  /** Ids of the items already chosen: their suggestions are disabled. */
  readonly taken: (id: string) => boolean;
  /** The slot slides in (it appears after the previous one was filled). */
  readonly entering?: boolean;
  readonly focusOnMount?: boolean;
  readonly onPick: (suggestion: DrugSuggestion) => void;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [suggestions, setSuggestions] = createSignal<readonly DrugSuggestion[]>([]);
  /** The text the current suggestions answer; differs from the field while the search is pending. */
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
      void findDrugCandidates(core, loaded, text).then((found) => {
        if (untrack(() => query().trim()) !== text) return;
        const drugs = found.map((candidate): DrugSuggestion => ({ kind: 'drug', candidate }));
        setSuggestions(namesAlcohol(text) ? [{ kind: 'alcohol' }, ...drugs] : drugs);
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
    <div
      class="drug-interactions__slot"
      classList={{ 'drug-interactions__slot--enter': props.entering }}
    >
      <SearchField
        class="drug-interactions__search"
        label={props.label}
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
        <ul class="drug-interactions__candidates" aria-label="Найденные препараты">
          <For each={suggestions()}>
            {(suggestion) => {
              const id =
                suggestion.kind === 'alcohol' ? ALCOHOL_ITEM_ID : suggestion.candidate.slug;
              return (
                <li class="drug-interactions__candidate-row">
                  <button
                    type="button"
                    class="drug-interactions__candidate"
                    disabled={props.taken(id)}
                    onClick={() => {
                      clear();
                      props.onPick(suggestion);
                    }}
                  >
                    <AppGlyph name={props.taken(id) ? 'check' : 'plus'} />
                    <span class="drug-interactions__candidate-name">
                      {suggestion.kind === 'alcohol' ? 'Алкоголь' : suggestion.candidate.label}
                    </span>
                    <Show when={suggestion.kind === 'alcohol'}>
                      <span class="drug-interactions__candidate-note">не препарат</span>
                    </Show>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
      <Show when={nothingFound()}>
        <div class="drug-interactions__nothing" role="status">
          <span class="drug-interactions__hint">Ничего не найдено.</span>
          <DrugCatalogOffer onContentChanged={props.onContentChanged} />
        </div>
      </Show>
    </div>
  );
}
