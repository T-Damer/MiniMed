import { Popover } from '@kobalte/core/popover';
import type { MedicalDocumentSummary } from '@localmed/contracts';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-solid';
import { createMemo, createSignal, For, Index, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { SearchField } from '@/components/SearchField';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import { SearchSectionDownload } from '@/features/search/SearchSectionDownload';
import type { SearchCatalogSection, SearchCatalogTool } from '@/features/search/searchCatalog';
import { RESULT_KIND_VISUALS } from '@/features/search/searchResultKindVisuals';
import {
  EMPTY_SEARCH_DOWNLOAD_BLOCK,
  searchSectionDownloadBlocks,
} from '@/features/search/searchSectionDownloads';
import { useSearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';
import { SETTINGS_DOWNLOADS_HASH } from '@/features/settings/settings-routing';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

export function SearchSectionPicker(props: {
  readonly loading: boolean;
  readonly documents: readonly MedicalDocumentSummary[];
  readonly tools: readonly SearchCatalogTool[];
  readonly onContentChanged: () => Promise<void>;
  readonly sections: readonly SearchCatalogSection[];
  readonly scope: SearchScope;
  readonly group: string | undefined;
  readonly onSelect: (scope: SearchScope, group?: string) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const downloads = useSearchSectionDownloads(open, () => props.onContentChanged());
  const downloadBlocks = createMemo(() => {
    downloads.preferenceRevision();
    return searchSectionDownloadBlocks(props.documents, props.tools, downloads.catalog());
  });
  const block = (scope: SearchScope, group = '') =>
    downloadBlocks().get(`${scope}/${group}`) ?? EMPTY_SEARCH_DOWNLOAD_BLOCK;
  const [query, setQuery] = createSignal('');
  const [expanded, setExpanded] = createSignal<SearchScope>();
  const selected = () => props.sections.find((section) => section.id === props.scope);
  const selectedGroup = () => selected()?.groups.find((group) => group.id === props.group);
  const rows = createMemo(() =>
    props.sections.flatMap((section) => {
      const matchesSection = matchesFuzzyQuery(query(), [section.label]);
      const groups = section.groups.filter(
        (group) => matchesSection || matchesFuzzyQuery(query(), [group.label]),
      );
      return matchesSection || groups.length ? [{ section, groups }] : [];
    }),
  );
  const select = (scope: SearchScope, group?: string): void => {
    props.onSelect(scope, group);
    setOpen(false);
  };
  return (
    <Popover
      open={open()}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setQuery('');
          setExpanded(props.group ? props.scope : undefined);
        }
      }}
      placement="bottom-start"
      gutter={6}
      fitViewport
      overflowPadding={8}
    >
      <Popover.Trigger class="search-source-picker" aria-label="Раздел поиска">
        <AppGlyph
          name={
            selectedGroup()?.kinds.length === 1
              ? RESULT_KIND_VISUALS[selectedGroup()?.kinds[0] ?? 'reference'].icon
              : (selected()?.icon ?? 'book-open')
          }
          class="search-source-picker__icon"
        />
        <span class="search-source-picker__label">
          {selectedGroup()?.label ?? selected()?.label}{' '}
          <Show when={(selectedGroup()?.count ?? selected()?.count) !== undefined}>
            ({selectedGroup()?.count ?? selected()?.count})
          </Show>
        </span>
        <AppGlyph name="caret-down" class="search-source-picker__icon" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="search-section-menu" aria-label="Разделы поиска">
          <SearchField
            class="search-section-menu__search"
            label="Найти раздел или подраздел"
            hideLabel
            placeholder="Найти раздел или подраздел…"
            value={query()}
            onInput={setQuery}
            onClear={() => setQuery('')}
          />
          <OverlayScrollbarsComponent
            class="search-section-menu__list"
            options={{ overflow: { x: 'hidden', y: 'scroll' }, scrollbars: { autoHide: 'never' } }}
            events={{
              initialized: (instance) =>
                instance.elements().viewport.classList.add('search-section-menu__viewport'),
            }}
            defer
          >
            <div class="search-section-menu__items">
              <Index each={rows()}>
                {(row) => {
                  const section = () => row().section;
                  const groups = () => row().groups;
                  return (
                    <div
                      class="search-section-menu__section"
                      classList={{
                        'search-section-menu__section--expanded':
                          groups().length > 0 &&
                          (Boolean(query().trim()) || expanded() === section().id),
                      }}
                    >
                      <div class="search-section-menu__row">
                        <button
                          class="search-section-menu__option search-section-menu__option--top"
                          classList={{
                            'search-section-menu__option--selected':
                              props.scope === section().id &&
                              !props.group &&
                              !(
                                groups().length > 0 &&
                                (Boolean(query().trim()) || expanded() === section().id)
                              ),
                          }}
                          type="button"
                          onClick={() => select(section().id)}
                        >
                          <AppGlyph name={section().icon} class="search-section-menu__icon" />
                          <span class="search-section-menu__label">{section().label}</span>
                          <Show when={section().count !== undefined}>
                            <span class="search-section-menu__count">({section().count})</span>
                          </Show>
                        </button>
                        <SearchSectionDownload
                          label={section().label}
                          block={block(section().id)}
                          downloads={downloads}
                          loading={props.loading}
                          noDownload={section().id === 'diagnosis'}
                        />
                        <Show when={groups().length > 0}>
                          <button
                            class="search-section-menu__expand"
                            type="button"
                            aria-label={`Подразделы: ${section().label}`}
                            aria-expanded={Boolean(query().trim()) || expanded() === section().id}
                            onClick={() =>
                              setExpanded(expanded() === section().id ? undefined : section().id)
                            }
                          >
                            <AppGlyph
                              name={
                                query().trim() || expanded() === section().id
                                  ? 'caret-up'
                                  : 'caret-down'
                              }
                              class="search-section-menu__icon"
                            />
                          </button>
                        </Show>
                      </div>
                      <Show when={query().trim() || expanded() === section().id}>
                        <Index each={groups()}>
                          {(group) => (
                            <div class="search-section-menu__row search-section-menu__row--child">
                              <button
                                class="search-section-menu__option search-section-menu__option--child"
                                classList={{
                                  'search-section-menu__option--selected':
                                    props.scope === section().id && props.group === group().id,
                                }}
                                type="button"
                                onClick={() => select(section().id, group().id)}
                              >
                                <span class="search-section-menu__kinds">
                                  <For each={group().kinds}>
                                    {(kind) => (
                                      <span
                                        class="search-section-menu__kind"
                                        title={RESULT_KIND_VISUALS[kind].label}
                                      >
                                        <AppGlyph
                                          name={RESULT_KIND_VISUALS[kind].icon}
                                          class="search-section-menu__kind-icon"
                                        />
                                      </span>
                                    )}
                                  </For>
                                </span>
                                <span class="search-section-menu__label">{group().label}</span>
                                <span class="search-section-menu__count">({group().count})</span>
                              </button>
                              <SearchSectionDownload
                                label={group().label}
                                block={block(section().id, group().id)}
                                downloads={downloads}
                                loading={props.loading}
                              />
                            </div>
                          )}
                        </Index>
                      </Show>
                    </div>
                  );
                }}
              </Index>
              <Show when={rows().length === 0}>
                <p class="search-section-menu__empty">Разделы не найдены</p>
              </Show>
            </div>
          </OverlayScrollbarsComponent>
          <a
            class="search-section-menu__downloads"
            href={SETTINGS_DOWNLOADS_HASH}
            onClick={() => setOpen(false)}
          >
            Загрузки
            <AppGlyph name="caret-right" class="search-section-menu__downloads-icon" />
          </a>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
