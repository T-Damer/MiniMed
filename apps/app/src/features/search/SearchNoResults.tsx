import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { ChoiceChip, ChoiceChipList } from '@/components/ChoiceChip';
import { SearchDownloadChip } from '@/features/search/SearchDownloadChip';
import type { SearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';

export interface SearchNoResultsDownload {
  readonly id: string;
  readonly label: string;
  readonly modules: readonly ContentModuleCatalogEntry[];
}

/** Explains an empty result list and offers the next useful step instead of a blank page. */
export function SearchNoResults(props: {
  readonly query: string;
  readonly downloads: SearchSectionDownloads;
  /** Sections whose published modules are not installed yet. */
  readonly missing: readonly SearchNoResultsDownload[];
  readonly onSearchEverywhere?: (() => void) | undefined;
}): JSX.Element {
  const words = () => props.query.trim().split(/\s+/u).filter(Boolean).length;
  return (
    <section class="search-no-results" role="status" aria-live="polite">
      <div class="search-no-results__heading">
        <span class="search-no-results__icon" aria-hidden="true">
          <AppGlyph name="binoculars" class="search-no-results__glyph" />
        </span>
        <div class="search-no-results__copy">
          <h2 class="search-no-results__title">Ничего не найдено</h2>
          <p class="search-no-results__text">
            <Show
              when={props.missing.length > 0}
              fallback="В установленных источниках нет совпадений с этим запросом."
            >
              Поиск идёт только по скачанным базам. Нужный документ может быть в ещё не скачанной.
            </Show>
          </p>
        </div>
      </div>
      <Show when={props.missing.length > 0 || props.onSearchEverywhere}>
        <ChoiceChipList label="Что можно сделать" class="search-no-results__actions">
          <For each={props.missing}>
            {(section, index) => (
              <SearchDownloadChip
                label={`Скачать: ${section.label}`}
                modules={section.modules}
                downloads={props.downloads}
                accent={index() === 0}
              />
            )}
          </For>
          <Show when={props.onSearchEverywhere}>
            {(searchEverywhere) => (
              <ChoiceChip
                icon={<AppGlyph name="books" class="choice-chip__glyph" />}
                onClick={() => searchEverywhere()()}
              >
                Искать во всех источниках
              </ChoiceChip>
            )}
          </Show>
        </ChoiceChipList>
      </Show>
      <Show when={words() > 1}>
        <p class="search-no-results__hint">
          Попробуйте короче: только название препарата, заболевания или код МКБ.
        </p>
      </Show>
    </section>
  );
}
