import { createSignal, For, type JSX, Show } from 'solid-js';

import { AtcCodeSheet } from '@/features/medications/AtcCodeSheet';
import type {
  DrugAtcCode,
  DrugGroupLink,
  DrugQuickLinksModel,
  DrugRelatedProduct,
  DrugSubstanceLink,
} from '@/features/medications/drug-screen';
import type { MedicationProduct } from '@/features/medications/medication-record';
import { pluralRu } from '@/i18n/labels';

import '@/features/medications/drug-screen.css';

/** Chips shown before «ещё N»; a longer list is folded. */
export const DRUG_CHIP_LIMIT = 6;

function ChipRow<T>(props: {
  readonly id: string;
  readonly label: string;
  readonly items: readonly T[];
  readonly limit?: number;
  readonly children: (item: T) => JSX.Element;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const limit = (): number => props.limit ?? DRUG_CHIP_LIMIT;
  // «ещё 1» would take the place of the chip it hides: fold only when it saves at least two.
  const folded = (): boolean => props.items.length > limit() + 1;
  const hidden = (): number => (folded() ? props.items.length - limit() : 0);
  const visible = (): readonly T[] =>
    folded() && !expanded() ? props.items.slice(0, limit()) : props.items;
  return (
    <section class="drug-links__group" aria-labelledby={props.id}>
      <p class="drug-links__label" id={props.id}>
        {props.label}
      </p>
      <ul class="drug-links__list">
        <For each={visible()}>
          {(item) => <li class="drug-links__item">{props.children(item)}</li>}
        </For>
        <Show when={hidden() > 0}>
          <li class="drug-links__item">
            <button
              type="button"
              class="drug-chip drug-chip--more"
              aria-expanded={expanded()}
              aria-label={
                expanded()
                  ? 'Свернуть список'
                  : `Показать ещё ${String(hidden())} ${pluralRu(hidden(), 'вариант', 'варианта', 'вариантов')}`
              }
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded() ? 'Свернуть' : `ещё ${String(hidden())}`}
            </button>
          </li>
        </Show>
      </ul>
    </section>
  );
}

/**
 * Right under the header: the links a physician reaches for first. Only rows the data supports are
 * drawn: other trade names, the active substance, the pharmacological group, the ATC code.
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
          >
            {(item: DrugRelatedProduct) => (
              <button
                type="button"
                class="drug-chip"
                aria-label={`Открыть: ${item.label}`}
                onClick={() => props.onSelectProduct(item.product)}
              >
                {item.label}
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
