import type { SearchDrugClass } from '@localmed/contracts';
import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { openAtcGroup } from '@/features/medications/medication-navigation';
import { pluralRu } from '@/i18n/labels';
import '@/features/search/drug-class-card.css';

/**
 * The class a query named («макролиды»): its name, the ATC groups it stands for with their
 * dictionary names, each a link to the drugs of the group; the drugs themselves lead the results
 * below (SRCH1, owner decision 2026-10-14). Nothing here is generated: every name is the НСИ «АТХ»
 * name of a group, every count the number of drugs the directory holds under its code.
 */
export function DrugClassCard(props: { readonly drugClass: SearchDrugClass }): JSX.Element {
  const count = () =>
    `${props.drugClass.drugCount} ${pluralRu(props.drugClass.drugCount, 'вещество', 'вещества', 'веществ')}`;
  const rest = () => props.drugClass.drugCount - props.drugClass.listed;
  return (
    <section class="drug-class-card" data-testid="drug-class-card" aria-label="Класс препаратов">
      <div class="drug-class-card__head">
        <AppGlyph name="prescription" class="drug-class-card__icon" />
        <h2 class="drug-class-card__title">{props.drugClass.label}</h2>
        <span class="drug-class-card__count">{count()}</span>
      </div>
      <ul class="drug-class-card__groups" aria-label="Группы АТХ">
        <For each={props.drugClass.groups}>
          {(group) => (
            <li class="drug-class-card__group-item">
              <button
                type="button"
                class="drug-class-card__group"
                data-testid="drug-class-group"
                onClick={() => openAtcGroup(group.code)}
              >
                <span class="drug-class-card__code">{group.code}</span>
                <Show when={group.name}>
                  {(name) => <span class="drug-class-card__name">{name()}</span>}
                </Show>
                <span class="drug-class-card__group-count">{group.drugCount}</span>
                <AppGlyph name="caret-right" class="drug-class-card__chevron" />
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={rest() > 0 && props.drugClass.groups[0]}>
        {(first) => (
          <button
            type="button"
            class="drug-class-card__more"
            data-testid="drug-class-more"
            onClick={() => openAtcGroup(first().code)}
          >
            {`Ещё ${rest()} ${pluralRu(rest(), 'вещество', 'вещества', 'веществ')} в группах`}
          </button>
        )}
      </Show>
    </section>
  );
}
