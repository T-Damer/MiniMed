import { Popover } from '@kobalte/core/popover';
import type { MedicalDocumentSummary } from '@localmed/contracts';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-solid';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { MarqueeText } from '@/components/MarqueeText';
import { SearchField } from '@/components/SearchField';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import { SearchSectionDownload } from '@/features/search/SearchSectionDownload';
import type { SearchCatalogSection, SearchCatalogTool } from '@/features/search/searchCatalog';
import { RESULT_KIND_VISUALS } from '@/features/search/searchResultKindVisuals';
import {
  EMPTY_SEARCH_DOWNLOAD_BLOCK,
  searchSectionDownloadBlocks,
} from '@/features/search/searchSectionDownloads';
import type { SearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';
import { SETTINGS_DOWNLOADS_HASH } from '@/features/settings/settings-routing';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

/** Hover or keyboard focus anywhere in a row lets its long name scroll into view. */
function engagement(setEngaged: (engaged: boolean) => void) {
  return {
    onPointerEnter: () => setEngaged(true),
    onPointerLeave: () => setEngaged(false),
    onFocusIn: () => setEngaged(true),
    onFocusOut: () => setEngaged(false),
  };
}

export function SearchSectionPicker(props: {
  readonly loading: boolean;
  readonly documents: readonly MedicalDocumentSummary[];
  readonly tools: readonly SearchCatalogTool[];
  readonly downloads: SearchSectionDownloads;
  readonly sections: readonly SearchCatalogSection[];
  readonly scope: SearchScope;
  readonly group: string | undefined;
  readonly onSelect: (scope: SearchScope, group?: string) => void;
}): JSX.Element {
  let menu: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const [open, setOpen] = createSignal(false);
  const downloads = props.downloads;
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
  // A popover whose trigger has scrolled away floats over unrelated content; close it. Scrolling
  // that keeps the trigger on screen (reaching a lower row, scroll restoration) keeps it open.
  createEffect(() => {
    if (!open()) return;
    const close = (): void => {
      const rect = trigger?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) setOpen(false);
    };
    window.addEventListener('scroll', close, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', close));
  });
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
          downloads.refresh();
          setQuery('');
          setExpanded(props.group ? props.scope : undefined);
        }
      }}
      placement="bottom-start"
      gutter={6}
      fitViewport
      overflowPadding={8}
    >
      <Popover.Trigger
        ref={(element: HTMLButtonElement) => {
          trigger = element;
        }}
        class="search-source-picker"
        aria-label="Раздел поиска"
      >
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
          {/* Until documents load only tools are counted, so the total would jump (71 → 24 819). */}
          <Show
            when={!props.loading && (selectedGroup()?.count ?? selected()?.count) !== undefined}
          >
            ({selectedGroup()?.count ?? selected()?.count})
          </Show>
        </span>
        <AppGlyph name="caret-down" class="search-source-picker__icon" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={menu}
          class="search-section-menu"
          aria-label="Разделы поиска"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            // Focusing without preventScroll scrolled the page (smoothly), which the scroll
            // handler above read as the user leaving and closed the menu right after opening.
            menu?.focus({ preventScroll: true });
          }}
        >
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
                  const sectionSelected = () =>
                    props.scope === section().id &&
                    !props.group &&
                    !(
                      groups().length > 0 &&
                      (Boolean(query().trim()) || expanded() === section().id)
                    );
                  const [sectionEngaged, setSectionEngaged] = createSignal(false);
                  return (
                    <div
                      class="search-section-menu__section"
                      classList={{
                        'search-section-menu__section--expanded':
                          groups().length > 0 &&
                          (Boolean(query().trim()) || expanded() === section().id),
                      }}
                    >
                      <div
                        class="search-section-menu__row"
                        classList={{
                          // The whole row carries the selection, not only the label button.
                          'search-section-menu__row--selected': sectionSelected(),
                        }}
                        {...engagement(setSectionEngaged)}
                      >
                        <button
                          class="search-section-menu__option search-section-menu__option--top"
                          type="button"
                          aria-label={`${section().label} (${section().count})`}
                          onClick={() => select(section().id)}
                        >
                          <AppGlyph name={section().icon} class="search-section-menu__icon" />
                          <MarqueeText
                            class="search-section-menu__label"
                            active={sectionSelected() || sectionEngaged()}
                          >
                            {section().label}
                          </MarqueeText>
                        </button>
                        <SearchSectionDownload
                          label={section().label}
                          block={block(section().id)}
                          downloads={downloads}
                          loading={props.loading}
                          noDownload={section().id === 'diagnosis'}
                        />
                        <span class="search-section-menu__count">
                          {props.loading ? '…' : section().count}
                        </span>
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
                          {(group) => {
                            const groupSelected = () =>
                              props.scope === section().id && props.group === group().id;
                            const [groupEngaged, setGroupEngaged] = createSignal(false);
                            return (
                              <div
                                class="search-section-menu__row search-section-menu__row--child"
                                classList={{
                                  'search-section-menu__row--selected': groupSelected(),
                                }}
                                {...engagement(setGroupEngaged)}
                              >
                                <button
                                  class="search-section-menu__option search-section-menu__option--child"
                                  type="button"
                                  aria-label={`${group().label} (${group().count})`}
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
                                  <MarqueeText
                                    class="search-section-menu__label"
                                    active={groupSelected() || groupEngaged()}
                                  >
                                    {group().label}
                                  </MarqueeText>
                                </button>
                                <SearchSectionDownload
                                  label={group().label}
                                  block={block(section().id, group().id)}
                                  downloads={downloads}
                                  loading={props.loading}
                                />
                                <span class="search-section-menu__count">
                                  {props.loading ? '…' : group().count}
                                </span>
                              </div>
                            );
                          }}
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
