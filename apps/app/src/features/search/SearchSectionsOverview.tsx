import { For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import type { SectionOverviewRow } from '@/features/search/sections-overview';

import './search-sections.css';

/**
 * The empty home screen lists what can be searched instead of an endless catalog: each section
 * with how many entries it holds. Choosing one opens its catalog, as the source picker does.
 */
export function SearchSectionsOverview(props: {
  readonly rows: readonly SectionOverviewRow[];
  readonly onSelect: (scope: SearchScope) => void;
}): JSX.Element {
  return (
    <section class="search-sections" aria-labelledby="search-sections-title">
      <h2 class="search-sections__title" id="search-sections-title">
        Разделы
      </h2>
      <ul class="search-sections__list">
        <For each={props.rows}>
          {(row) => (
            <li class="search-sections__item">
              <button
                type="button"
                class="search-sections__row"
                onClick={() => props.onSelect(row.id)}
              >
                <span class="search-sections__icon-frame">
                  <AppGlyph name={row.icon} class="search-sections__icon" />
                </span>
                <span class="search-sections__name">{row.label}</span>
                <span
                  class="search-sections__count"
                  classList={{ 'search-sections__count--empty': row.empty }}
                >
                  {row.countLabel === null
                    ? 'считаем…'
                    : row.empty
                      ? 'нет в установленных базах'
                      : row.countLabel}
                </span>
                <AppGlyph name="caret-right" class="search-sections__caret" />
              </button>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
