import type { MedicalCore } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ListGroup, ListRow } from '@/components/ListRow';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import { AtcMatchBadge } from '@/features/medications/AtcMatchBadge';
import type { AtcNameCatalog } from '@/features/medications/atc-code';
import { breakableDrugName } from '@/features/medications/drug-label';
import { type FoundDrug, findDrugs } from './comparison-candidates';
import type { ComparisonIndex } from './comparison-index';
import { cardTitle, drugGroupOf, sameGroupSuggestions } from './comparison-picker';

/** The typed name waits this long before the drug search runs. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Drugs as rows of the app's list: the name, the drug's ATC group under it, a tick on a drug that
 * is already compared (that row is not offered again).
 */
export function ComparisonDrugRows(props: {
  readonly index: ComparisonIndex;
  readonly names: AtcNameCatalog | null;
  readonly drugs: readonly FoundDrug[];
  readonly heading?: JSX.Element;
  readonly label: string;
  readonly chosen: (drug: FoundDrug) => boolean;
  /** No more drugs can be added. */
  readonly full: boolean;
  readonly onPick: (drug: FoundDrug) => void;
}): JSX.Element {
  const group = (drug: FoundDrug): string | undefined => {
    const at = props.index.cardBySlug.get(drug.slug);
    const card = at === undefined ? undefined : props.index.asset.cards[at];
    return card ? drugGroupOf(card, props.names)?.name : undefined;
  };
  return (
    <ListGroup class="drug-comparison__rows" heading={props.heading} label={props.label}>
      <For each={props.drugs}>
        {(drug) => (
          <ListRow
            class="drug-comparison__row"
            data-testid="comparison-candidate"
            icon="pill"
            tone="green"
            title={breakableDrugName(drug.label)}
            subtitle={group(drug)}
            value={
              props.chosen(drug) ? (
                <span class="drug-comparison__row-check" title="Уже в сравнении">
                  <AppGlyph name="check" class="drug-comparison__row-check-glyph" />
                </span>
              ) : drug.atc ? (
                <AtcMatchBadge match={drug.atc} />
              ) : undefined
            }
            selected={props.chosen(drug)}
            disabled={props.chosen(drug) || props.full}
            chevron={false}
            onClick={() => props.onPick(drug)}
          />
        )}
      </For>
    </ListGroup>
  );
}

/**
 * «Выбрать препарат» of the comparison: a sheet with a search field and the list. Before anything is
 * typed it lists the drugs of the chosen drug's ATC group; a pick adds the drug and closes the sheet.
 */
export function ComparisonDrugPicker(props: {
  readonly open: boolean;
  readonly core: MedicalCore | undefined;
  readonly index: ComparisonIndex;
  readonly names: AtcNameCatalog | null;
  /** Card indexes of the drugs already compared. */
  readonly chosenCards: readonly number[];
  readonly chosen: (drug: FoundDrug) => boolean;
  readonly full: boolean;
  readonly onPick: (drug: FoundDrug) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [found, setFound] = createSignal<readonly FoundDrug[]>([]);
  const [searched, setSearched] = createSignal('');
  createEffect(() => {
    if (!props.open) {
      setQuery('');
      setFound([]);
      setSearched('');
    }
  });
  createEffect(() => {
    const text = query().trim();
    const core = props.core;
    if (text.length < 2 || !core) {
      setFound([]);
      setSearched('');
      return;
    }
    const handle = setTimeout(() => {
      void findDrugs(core, text).then((drugs) => {
        if (untrack(() => query().trim()) !== text) return;
        setFound(drugs);
        setSearched(text);
      });
    }, SEARCH_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(handle));
  });
  const suggestions = createMemo(() => {
    const result = sameGroupSuggestions(props.index, props.chosenCards, props.names);
    if (!result) return null;
    const drugs = result.cards.flatMap((at): FoundDrug[] => {
      const card = props.index.asset.cards[at];
      return card ? [{ slug: card.s, label: cardTitle(card), product: null }] : [];
    });
    return { group: result.group, drugs };
  });
  const typing = (): boolean => query().trim().length >= 2;
  return (
    <OverlayDialog
      open={props.open}
      title="Выбрать препарат"
      class="drug-comparison-picker"
      bodyClass="drug-comparison-picker__body"
      onClose={props.onClose}
    >
      <div class="drug-comparison-picker__content" data-testid="comparison-picker">
        <SearchField
          class="drug-comparison-picker__search"
          label="Найти препарат"
          hideLabel
          placeholder="Препарат, МНН или код АТХ"
          value={query()}
          onInput={setQuery}
          onClear={() => setQuery('')}
        />
        <Show
          when={typing()}
          fallback={
            <Show when={suggestions()}>
              {(list) => (
                <ComparisonDrugRows
                  index={props.index}
                  names={props.names}
                  drugs={list().drugs}
                  heading={list().group.name}
                  label={`Группа «${list().group.name}»`}
                  chosen={props.chosen}
                  full={props.full}
                  onPick={props.onPick}
                />
              )}
            </Show>
          }
        >
          <Show
            when={found().length > 0}
            fallback={
              <Show when={searched() !== '' && searched() === query().trim()}>
                <p class="drug-comparison-picker__empty" role="status">
                  Ничего не найдено
                </p>
              </Show>
            }
          >
            <ComparisonDrugRows
              index={props.index}
              names={props.names}
              drugs={found()}
              label="Найденные препараты"
              chosen={props.chosen}
              full={props.full}
              onPick={props.onPick}
            />
          </Show>
        </Show>
      </div>
    </OverlayDialog>
  );
}
