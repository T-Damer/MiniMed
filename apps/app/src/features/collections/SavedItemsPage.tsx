import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';

import { AppGlyph } from '@/components/AppGlyph';
import { createDebouncedValue } from '@/components/debounced-value';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { Heading } from '@/components/Text';
import { SavedItemRow } from '@/features/collections/SavedItemRow';
import { buildSavedSections, type SavedEntry } from '@/features/collections/saved-items';
import { quickToolsFromCatalog } from '@/features/search/quick-tools';
import { searchCatalogTools } from '@/features/search/searchCatalog';
import {
  itemCollections,
  setItemInCollection,
  toggleFavoriteItem,
  updateItemCollections,
} from '@/state/item-collections';

import './saved-items.css';

const SEARCH_DEBOUNCE_MS = 150;

/**
 * «Избранное»: everything the doctor saved with the bookmark — favourites and named collections —
 * in one list that the field above filters. It is the Files folder of the same name.
 */
export function SavedItemsPage(props: {
  readonly backLabel: string;
  readonly onBack: () => void;
}): JSX.Element {
  const [query, setQuery] = createSignal('');
  const settled = createDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const toolsById = createMemo(
    () => new Map(quickToolsFromCatalog(searchCatalogTools()).map((tool) => [tool.id, tool])),
  );
  const sections = createMemo(() => buildSavedSections(itemCollections(), toolsById(), settled()));
  const nothingSaved = createMemo(
    () => buildSavedSections(itemCollections(), toolsById()).length === 0,
  );
  const remove = (sectionId: string, entry: SavedEntry): void => {
    const now = new Date().toISOString();
    updateItemCollections((state) =>
      sectionId === 'favorites'
        ? toggleFavoriteItem(state, entry.ref, now)
        : setItemInCollection(state, sectionId, entry.ref, false, now),
    );
  };
  return (
    <section class="saved-items" aria-label="Избранное">
      <Page
        hero={PAGE_HEROES.saved}
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label={props.backLabel}
            onClick={props.onBack}
          />
        }
        title={<Heading depth={1}>Избранное</Heading>}
        help={
          <p>
            Сюда попадает всё, что сохранено кнопкой-закладкой: документы, препараты, записи и ваши
            коллекции.
          </p>
        }
        helpTitle="Об избранном"
      />
      <SearchField
        class="saved-items__search"
        value={query()}
        onInput={setQuery}
        label="Поиск по сохранённому"
        hideLabel
        placeholder="Название"
      />
      <Show
        when={!nothingSaved()}
        fallback={
          <p class="saved-items__empty">
            <AppGlyph name="bookmark" class="saved-items__empty-icon" />
            Закладка на странице документа сохранит его сюда.
          </p>
        }
      >
        <Show
          when={sections().length > 0}
          fallback={<p class="saved-items__empty">Ничего не найдено.</p>}
        >
          <For each={sections()}>
            {(section) => (
              <section class="saved-items__section" aria-label={section.title}>
                <h2 class="saved-items__heading">
                  {section.title}
                  <span class="saved-items__count">{section.entries.length}</span>
                </h2>
                <Show
                  when={section.entries.length > 0}
                  fallback={<p class="saved-items__hint">Пусто.</p>}
                >
                  <ul class="saved-items__list">
                    <For each={section.entries}>
                      {(entry) => (
                        <SavedItemRow entry={entry} onRemove={() => remove(section.id, entry)} />
                      )}
                    </For>
                  </ul>
                </Show>
              </section>
            )}
          </For>
        </Show>
      </Show>
    </section>
  );
}
