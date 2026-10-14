import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { AtcCodeSheet, type AtcSheetFocus } from '@/features/medications/AtcCodeSheet';
import {
  DRUG_ACCORDION_VISIBLE,
  type DrugAtcCode,
  type DrugGroupLink,
  type DrugQuickLinksModel,
  type DrugRelatedProduct,
  type DrugSubstanceLink,
  drugAtcCodeLabel,
} from '@/features/medications/drug-screen';
import type { MedicationProduct } from '@/features/medications/medication-record';
import { pluralRu } from '@/i18n/labels';

import '@/features/medications/drug-screen.css';

/** Meta chips (substance, group, ATC code) shown before «ещё N»; a longer row is folded. */
export const DRUG_CHIP_LIMIT = 4;

/**
 * The code of a drug as one control: the code, and — beside an agreed code the registry holds only
 * as a group stub — the registry's own value in the same pill. Each part opens the code sheet on its
 * own ladder, so the tapped code is the one the sheet highlights.
 */
export function DrugAtcChip(props: {
  readonly code: DrugAtcCode;
  readonly onOpen: (code: DrugAtcCode, focus: AtcSheetFocus) => void;
}): JSX.Element {
  const label = () => drugAtcCodeLabel(props.code);
  return (
    <span class="drug-code" classList={{ 'drug-code--split': label().registryCode !== null }}>
      <button
        type="button"
        class="drug-chip drug-chip--code drug-code__main"
        aria-haspopup="dialog"
        aria-label={label().ariaLabel}
        onClick={() => props.onOpen(props.code, 'main')}
      >
        {label().code}
      </button>
      <Show when={label().registryCode}>
        {(registry) => (
          <button
            type="button"
            class="drug-code__registry"
            aria-haspopup="dialog"
            aria-label={`Код АТХ ${registry()} в реестре: пояснить по уровням`}
            onClick={() => props.onOpen(props.code, 'registry')}
          >
            <span class="drug-code__registry-text">в реестре</span>
            <span class="drug-code__registry-code">{registry()}</span>
          </button>
        )}
      </Show>
    </span>
  );
}

/**
 * A wrapped row of small chips. Past `limit` the rest is folded: «ещё N» ends the row and the
 * remainder opens under it like the app's other disclosures (a 0fr → 1fr grid track).
 */
function FoldedChips<T>(props: {
  readonly items: readonly T[];
  readonly limit: number;
  /** A short word that leads the first line of chips («Аналоги»). */
  readonly lead?: string;
  readonly children: (item: T) => JSX.Element;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const panelId = createUniqueId();
  const folded = (): boolean => props.items.length > props.limit + 1;
  const head = (): readonly T[] => (folded() ? props.items.slice(0, props.limit) : props.items);
  const rest = (): readonly T[] => (folded() ? props.items.slice(props.limit) : []);
  return (
    <>
      <ul class="drug-links__list">
        <Show when={props.lead}>{(lead) => <li class="drug-links__lead">{lead()}</li>}</Show>
        <For each={head()}>
          {(item) => <li class="drug-links__item">{props.children(item)}</li>}
        </For>
        <Show when={folded()}>
          <li class="drug-links__item">
            <button
              type="button"
              class="drug-links__toggle"
              aria-expanded={expanded()}
              aria-controls={panelId}
              aria-label={
                expanded()
                  ? 'Свернуть список'
                  : `Показать ещё ${String(rest().length)} ${pluralRu(rest().length, 'вариант', 'варианта', 'вариантов')}`
              }
              onClick={() => setExpanded((value) => !value)}
            >
              <span class="drug-links__toggle-label">
                {expanded() ? 'свернуть' : `ещё ${String(rest().length)}`}
              </span>
              <AppGlyph
                name="caret-down"
                class={`drug-links__toggle-icon${expanded() ? ' drug-links__toggle-icon--open' : ''}`}
              />
            </button>
          </li>
        </Show>
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
      </Show>
    </>
  );
}

type MetaChip =
  | { readonly kind: 'substance'; readonly link: DrugSubstanceLink }
  | { readonly kind: 'group'; readonly link: DrugGroupLink }
  | { readonly kind: 'atc'; readonly code: DrugAtcCode };

/** The substance, the groups and the ATC codes as one list of chips, in that order. */
function metaChips(links: DrugQuickLinksModel): readonly MetaChip[] {
  return [
    ...(links.substance ? [{ kind: 'substance' as const, link: links.substance }] : []),
    ...links.groups.map((link) => ({ kind: 'group' as const, link })),
    ...links.atc.map((code) => ({ kind: 'atc' as const, code })),
  ];
}

/**
 * Right under the header, in two small rows: what the drug is (active substance, pharmacological
 * group, ATC code) and its other trade names with their manufacturing country. Only what the data
 * supports is drawn; the comparison starts from the header's own icon.
 */
export function DrugQuickLinks(props: {
  readonly links: DrugQuickLinksModel;
  readonly onSelectProduct: (product: MedicationProduct) => void;
  readonly onOpenSubstance: (link: DrugSubstanceLink) => void;
  readonly onOpenGroup: (group: DrugGroupLink) => void;
}): JSX.Element {
  const [atc, setAtc] = createSignal<DrugAtcCode | undefined>();
  const [atcFocus, setAtcFocus] = createSignal<AtcSheetFocus>('main');
  const [atcOpen, setAtcOpen] = createSignal(false);
  const openAtc = (code: DrugAtcCode, focus: AtcSheetFocus): void => {
    setAtc(code);
    setAtcFocus(focus);
    setAtcOpen(true);
  };
  const chips = (): readonly MetaChip[] => metaChips(props.links);
  const empty = (): boolean => chips().length === 0 && props.links.related.length === 0;
  const relatedLimit = (): number =>
    props.links.relatedAccordion ? DRUG_ACCORDION_VISIBLE : DRUG_CHIP_LIMIT;

  return (
    <Show when={!empty()}>
      <nav class="drug-links" aria-label="Связанные сведения о препарате">
        <Show when={chips().length > 0}>
          <section class="drug-links__group" aria-label="Вещество, группа и код АТХ">
            <FoldedChips items={chips()} limit={DRUG_CHIP_LIMIT}>
              {(chip: MetaChip) => (
                <>
                  <Show when={chip.kind === 'substance' ? chip : undefined}>
                    {(entry) => (
                      <button
                        type="button"
                        class="drug-chip drug-chip--accent"
                        title="Действующее вещество"
                        aria-label={`Действующее вещество: ${entry().link.label}`}
                        onClick={() => props.onOpenSubstance(entry().link)}
                      >
                        {entry().link.label}
                      </button>
                    )}
                  </Show>
                  <Show when={chip.kind === 'group' ? chip : undefined}>
                    {(entry) => (
                      <button
                        type="button"
                        class="drug-chip"
                        title={entry().link.title}
                        aria-label={`Препараты группы: ${entry().link.label}`}
                        onClick={() => props.onOpenGroup(entry().link)}
                      >
                        {entry().link.label}
                      </button>
                    )}
                  </Show>
                  <Show when={chip.kind === 'atc' ? chip : undefined}>
                    {(entry) => <DrugAtcChip code={entry().code} onOpen={openAtc} />}
                  </Show>
                </>
              )}
            </FoldedChips>
          </section>
        </Show>
        <Show when={props.links.related.length > 0}>
          <section class="drug-links__group" aria-label={props.links.relatedTitle}>
            <FoldedChips
              items={props.links.related}
              limit={relatedLimit()}
              lead={props.links.relatedLabel}
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
            </FoldedChips>
          </section>
        </Show>
      </nav>
      <AtcCodeSheet
        code={atc()}
        focus={atcFocus()}
        open={atcOpen()}
        onClose={() => setAtcOpen(false)}
      />
    </Show>
  );
}
