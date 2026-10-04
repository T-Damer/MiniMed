import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { AtcCodeSheet } from '@/features/medications/AtcCodeSheet';
import {
  DRUG_ACCORDION_VISIBLE,
  type DrugAtcCode,
  type DrugGroupLink,
  type DrugQuickLinksModel,
  type DrugRelatedProduct,
  type DrugSubstanceLink,
} from '@/features/medications/drug-screen';
import type { MedicationProduct } from '@/features/medications/medication-record';
import { pluralRu } from '@/i18n/labels';

import '@/features/medications/drug-screen.css';

/** Chips shown before «ещё N»; a longer list is folded. */
export const DRUG_CHIP_LIMIT = 6;

/**
 * A row of chips. Past `limit` the rest is folded into a panel that opens like the app's other
 * disclosures (a 0fr → 1fr grid track); `foldAll` folds even a single chip, where otherwise «ещё 1»
 * would take the place of the chip it hides.
 */
function ChipRow<T>(props: {
  readonly id: string;
  readonly label: string;
  readonly items: readonly T[];
  readonly limit?: number | undefined;
  readonly foldAll?: boolean | undefined;
  readonly moreLabel?: ((hidden: number) => string) | undefined;
  readonly children: (item: T) => JSX.Element;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const panelId = createUniqueId();
  const limit = (): number => props.limit ?? DRUG_CHIP_LIMIT;
  const folded = (): boolean => props.items.length > limit() + (props.foldAll ? 0 : 1);
  const head = (): readonly T[] => (folded() ? props.items.slice(0, limit()) : props.items);
  const rest = (): readonly T[] => (folded() ? props.items.slice(limit()) : []);
  const moreLabel = (hidden: number): string =>
    props.moreLabel?.(hidden) ?? `ещё ${String(hidden)}`;
  return (
    <section class="drug-links__group" aria-labelledby={props.id}>
      <p class="drug-links__label" id={props.id}>
        {props.label}
      </p>
      <ul class="drug-links__list">
        <For each={head()}>
          {(item) => <li class="drug-links__item">{props.children(item)}</li>}
        </For>
      </ul>
      <Show when={folded()}>
        <div
          class="drug-links__more"
          classList={{ 'drug-links__more--open': expanded() }}
          id={panelId}
          inert={!expanded()}
        >
          <div class="drug-links__more-inner">
            <ul class="drug-links__list drug-links__list--rest">
              <For each={rest()}>
                {(item) => <li class="drug-links__item">{props.children(item)}</li>}
              </For>
            </ul>
          </div>
        </div>
        <button
          type="button"
          class="drug-links__toggle"
          aria-expanded={expanded()}
          aria-controls={panelId}
          aria-label={
            expanded()
              ? 'Свернуть список'
              : props.moreLabel
                ? undefined
                : `Показать ещё ${String(rest().length)} ${pluralRu(rest().length, 'вариант', 'варианта', 'вариантов')}`
          }
          onClick={() => setExpanded((value) => !value)}
        >
          <span class="drug-links__toggle-label">
            {expanded() ? 'Свернуть' : moreLabel(rest().length)}
          </span>
          <AppGlyph
            name="caret-down"
            class={`drug-links__toggle-icon${expanded() ? ' drug-links__toggle-icon--open' : ''}`}
          />
        </button>
      </Show>
    </section>
  );
}

/** «Показать ещё 5 названий»: the fold button of the substance card's trade-name list. */
function moreTradeNamesLabel(hidden: number): string {
  return `Показать ещё ${String(hidden)} ${pluralRu(hidden, 'название', 'названия', 'названий')}`;
}

/**
 * Right under the header: the links a physician reaches for first. Only rows the data supports are
 * drawn: other trade names (with their manufacturing country), the active substance, the
 * pharmacological group, the ATC code.
 */
export function DrugQuickLinks(props: {
  readonly links: DrugQuickLinksModel;
  readonly onSelectProduct: (product: MedicationProduct) => void;
  readonly onOpenSubstance: (link: DrugSubstanceLink) => void;
  readonly onOpenGroup: (group: DrugGroupLink) => void;
}): JSX.Element {
  const [atc, setAtc] = createSignal<DrugAtcCode | undefined>();
  const [atcOpen, setAtcOpen] = createSignal(false);
  const openAtc = (code: DrugAtcCode): void => {
    setAtc(code);
    setAtcOpen(true);
  };
  const empty = (): boolean =>
    props.links.related.length === 0 &&
    props.links.groups.length === 0 &&
    props.links.atc.length === 0 &&
    props.links.substance === null;

  return (
    <Show when={!empty()}>
      <nav class="drug-links" aria-label="Связанные сведения о препарате">
        <Show when={props.links.related.length > 0}>
          <ChipRow
            id="drug-links-related"
            label={props.links.relatedTitle}
            items={props.links.related}
            limit={props.links.relatedAccordion ? DRUG_ACCORDION_VISIBLE : undefined}
            foldAll={props.links.relatedAccordion}
            moreLabel={props.links.relatedAccordion ? moreTradeNamesLabel : undefined}
          >
            {(item: DrugRelatedProduct) => (
              <button
                type="button"
                class="drug-chip"
                aria-label={`Открыть: ${item.label}`}
                onClick={() => props.onSelectProduct(item.product)}
              >
                <span class="drug-chip__text">
                  {item.name}
                  <Show when={item.country}>
                    {(country) => (
                      <>
                        {' '}
                        <span class="drug-chip__country" title={item.countryTitle}>
                          ({country()})
                        </span>
                      </>
                    )}
                  </Show>
                </span>
              </button>
            )}
          </ChipRow>
        </Show>
        <Show when={props.links.substance}>
          {(substance) => (
            <section class="drug-links__group" aria-labelledby="drug-links-substance">
              <p class="drug-links__label" id="drug-links-substance">
                Действующее вещество
              </p>
              <ul class="drug-links__list">
                <li class="drug-links__item">
                  <button
                    type="button"
                    class="drug-chip drug-chip--accent"
                    aria-label={`Действующее вещество: ${substance().label}`}
                    onClick={() => props.onOpenSubstance(substance())}
                  >
                    {substance().label}
                  </button>
                </li>
              </ul>
            </section>
          )}
        </Show>
        <Show when={props.links.groups.length > 0}>
          <ChipRow
            id="drug-links-groups"
            label={
              props.links.groups.length > 1
                ? 'Фармакологические группы'
                : 'Фармакологическая группа'
            }
            items={props.links.groups}
          >
            {(group: DrugGroupLink) => (
              <button
                type="button"
                class="drug-chip"
                title={group.title}
                aria-label={`Препараты группы: ${group.label}`}
                onClick={() => props.onOpenGroup(group)}
              >
                {group.label}
              </button>
            )}
          </ChipRow>
        </Show>
        <Show when={props.links.atc.length > 0}>
          <ChipRow id="drug-links-atc" label="Код АТХ" items={props.links.atc} limit={6}>
            {(code: DrugAtcCode) => (
              <button
                type="button"
                class="drug-chip drug-chip--code"
                aria-haspopup="dialog"
                aria-label={`Код АТХ ${code.code}: пояснить по уровням`}
                onClick={() => openAtc(code)}
              >
                {code.code}
              </button>
            )}
          </ChipRow>
        </Show>
      </nav>
      <AtcCodeSheet code={atc()} open={atcOpen()} onClose={() => setAtcOpen(false)} />
    </Show>
  );
}
