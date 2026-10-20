import { createResource, createSignal, For, type JSX, Show } from 'solid-js';

import { AtcCodeSheet, type AtcSheetFocus } from '@/features/medications/AtcCodeSheet';
import { atcGroupName, atcGroupNameInline } from '@/features/medications/atc-group-name';
import { loadAtcNames } from '@/features/medications/atc-names';
import { DrugSecondaryClasses } from '@/features/medications/DrugSecondaryClasses';
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

/** Links of a line (substance, group, ATC code, analogues) shown before «ещё N»; a longer line is folded. */
export const DRUG_LINK_LIMIT = 3;

/**
 * The code of a drug as plain text links: the code, and — beside an agreed code the registry holds
 * only as a group stub — the registry's own value as a quieter link. Each opens the code sheet on
 * its own ladder, so the tapped code is the one the sheet highlights.
 */
export function DrugAtcChip(props: {
  readonly code: DrugAtcCode;
  readonly onOpen: (code: DrugAtcCode, focus: AtcSheetFocus) => void;
  /**
   * Say what the code is called (QA 0.6.60: «N02BE51» alone says nothing): the НСИ name of its
   * group, the level-4 group for a substance code. Off where the screen already names the group.
   */
  readonly named?: boolean;
}): JSX.Element {
  const label = () => drugAtcCodeLabel(props.code);
  const [names] = createResource(
    () => props.named === true,
    (wanted) =>
      wanted
        ? loadAtcNames().catch((cause: unknown) => {
            console.error('Не удалось загрузить названия групп АТХ.', cause);
            return undefined;
          })
        : undefined,
  );
  const groupName = (): string | null => {
    const catalog = names();
    const name = catalog ? atcGroupName(catalog.names, props.code.code) : null;
    return name === null ? null : atcGroupNameInline(name);
  };
  return (
    <span class="drug-code">
      <button
        type="button"
        class="drug-link drug-link--code drug-code__main"
        aria-haspopup="dialog"
        aria-label={`${label().ariaLabel}${groupName() ? ` (${groupName()})` : ''}`}
        onClick={() => props.onOpen(props.code, 'main')}
      >
        <span class="drug-code__code">{label().code}</span>
        <Show when={groupName()}>{(name) => <span class="drug-code__name"> · {name()}</span>}</Show>
      </button>
      <Show when={label().registryCode}>
        {(registry) => (
          <button
            type="button"
            class="drug-link drug-link--quiet drug-code__registry"
            aria-haspopup="dialog"
            aria-label={`Код АТХ ${registry()} в реестре: пояснить по уровням`}
            onClick={() => props.onOpen(props.code, 'registry')}
          >
            <span class="drug-code__registry-text">в реестре</span>{' '}
            <span class="drug-code__registry-code">{registry()}</span>
          </button>
        )}
      </Show>
    </span>
  );
}

/**
 * One line of plain text links, separated by «·» or commas, that wraps like text. Past `limit` the
 * rest is folded: «ещё N» ends the line and opens the remainder in place, fading in.
 */
function FoldedLinks<T>(props: {
  readonly items: readonly T[];
  readonly limit: number;
  readonly separator: 'dot' | 'comma';
  /** A short word that leads the line («Аналоги»). */
  readonly lead?: string;
  readonly children: (item: T) => JSX.Element;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const folded = (): boolean => props.items.length > props.limit + 1;
  const visible = (): readonly T[] =>
    folded() && !expanded() ? props.items.slice(0, props.limit) : props.items;
  const hiddenCount = (): number => props.items.length - props.limit;
  const separator = (): JSX.Element => (
    <span
      class="drug-links__sep"
      classList={{ 'drug-links__sep--comma': props.separator === 'comma' }}
      aria-hidden="true"
    >
      {props.separator === 'comma' ? ',' : '·'}
    </span>
  );
  return (
    <div class="drug-links__line">
      <Show when={props.lead}>{(lead) => <span class="drug-links__lead">{lead()}:</span>}</Show>
      <ul class="drug-links__list">
        <For each={visible()}>
          {(item, index) => (
            <>
              <li
                class="drug-links__item"
                classList={{ 'drug-links__item--revealed': folded() && index() >= props.limit }}
              >
                {props.children(item)}
                <Show when={folded() || index() < visible().length - 1}>{separator()}</Show>
              </li>
              {/* A real space between items: the only place a line may break. */}{' '}
            </>
          )}
        </For>
        <Show when={folded()}>
          <li class="drug-links__item">
            <button
              type="button"
              class="drug-link drug-link--toggle"
              aria-expanded={expanded()}
              aria-label={
                expanded()
                  ? 'Свернуть список'
                  : `Показать ещё ${String(hiddenCount())} ${pluralRu(hiddenCount(), 'вариант', 'варианта', 'вариантов')}`
              }
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded() ? 'свернуть' : `ещё ${String(hiddenCount())}`}
            </button>
          </li>
        </Show>
      </ul>
    </div>
  );
}

type MetaLink =
  | { readonly kind: 'substance'; readonly link: DrugSubstanceLink }
  | { readonly kind: 'group'; readonly link: DrugGroupLink }
  | { readonly kind: 'atc'; readonly code: DrugAtcCode };

/** The substance, the groups and the ATC codes as one list of links, in that order. */
function metaLinks(links: DrugQuickLinksModel): readonly MetaLink[] {
  return [
    ...(links.substance ? [{ kind: 'substance' as const, link: links.substance }] : []),
    ...links.groups.map((link) => ({ kind: 'group' as const, link })),
    ...links.atc.map((code) => ({ kind: 'atc' as const, code })),
  ];
}

/**
 * Right under the header, in two lines of plain text links: what the drug is (active substance,
 * pharmacological group, ATC code, and for a combination product one small «также: …» line with
 * the extra classes its components bring) and its other trade names with their manufacturing
 * country. Only what the data supports is drawn; the comparison starts from the header's «⋯» menu.
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
  const metas = (): readonly MetaLink[] => metaLinks(props.links);
  const empty = (): boolean =>
    metas().length === 0 && props.links.related.length === 0 && props.links.forms.length === 0;
  const relatedLimit = (): number =>
    props.links.relatedAccordion ? DRUG_ACCORDION_VISIBLE : DRUG_LINK_LIMIT;

  return (
    <Show when={!empty()}>
      <nav class="drug-links" aria-label="Связанные сведения о препарате">
        <Show when={props.links.forms.length > 0}>
          <section
            class="drug-links__group drug-links__forms"
            aria-label="Формы выпуска"
            data-testid="drug-forms"
          >
            <FoldedLinks
              items={props.links.forms}
              limit={DRUG_LINK_LIMIT}
              separator="dot"
              lead="Формы"
            >
              {(form: string) => <span class="drug-links__form">{form}</span>}
            </FoldedLinks>
          </section>
        </Show>
        <Show when={metas().length > 0}>
          <section class="drug-links__group" aria-label="Вещество, группа и код АТХ">
            <FoldedLinks items={metas()} limit={DRUG_LINK_LIMIT} separator="dot">
              {(entry: MetaLink) => (
                <>
                  <Show when={entry.kind === 'substance' ? entry : undefined}>
                    {(substance) => (
                      <button
                        type="button"
                        class="drug-link drug-link--substance"
                        title="Действующее вещество"
                        aria-label={`Действующее вещество: ${substance().link.label}`}
                        onClick={() => props.onOpenSubstance(substance().link)}
                      >
                        {substance().link.label}
                      </button>
                    )}
                  </Show>
                  <Show when={entry.kind === 'group' ? entry : undefined}>
                    {(group) => (
                      <button
                        type="button"
                        class="drug-link"
                        title={group().link.title}
                        aria-label={`Препараты группы: ${group().link.label}`}
                        onClick={() => props.onOpenGroup(group().link)}
                      >
                        {group().link.label}
                      </button>
                    )}
                  </Show>
                  <Show when={entry.kind === 'atc' ? entry : undefined}>
                    {(code) => (
                      <DrugAtcChip
                        code={code().code}
                        onOpen={openAtc}
                        named={props.links.groups.length === 0}
                      />
                    )}
                  </Show>
                </>
              )}
            </FoldedLinks>
            <DrugSecondaryClasses slug={props.links.compare?.slug} />
          </section>
        </Show>
        <Show when={props.links.related.length > 0}>
          <section class="drug-links__group" aria-label={props.links.relatedTitle}>
            <FoldedLinks
              items={props.links.related}
              limit={relatedLimit()}
              separator="comma"
              lead={props.links.relatedLabel}
            >
              {(item: DrugRelatedProduct) => (
                <button
                  type="button"
                  class="drug-link"
                  aria-label={`Открыть: ${item.label}`}
                  onClick={() => props.onSelectProduct(item.product)}
                >
                  {item.name}
                  <Show when={item.country}>
                    {(country) => (
                      <>
                        {' '}
                        <span class="drug-link__country" title={item.countryTitle}>
                          ({country()})
                        </span>
                      </>
                    )}
                  </Show>
                </button>
              )}
            </FoldedLinks>
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
