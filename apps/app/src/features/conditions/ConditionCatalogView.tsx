import type { MedicalCore } from '@localmed/contracts';
import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { CountBadge } from '@/components/CountBadge';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { Heading } from '@/components/Text';
import {
  buildConditionCatalog,
  CONDITION_CATALOG_SECTIONS,
  type ConditionCatalogEntry,
  type ConditionCatalogSection,
  type ConditionCatalogSource,
  conditionSectionLabel,
} from '@/features/conditions/condition-catalog';
import {
  CONDITION_CATALOG_HASH,
  conditionCatalogHash,
  parseConditionCatalogRoute,
} from '@/features/conditions/condition-routing';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentOverlay } from '@/state/document-navigation';
import { fuzzyQueryScore } from '@/state/fuzzy-text';

interface ConditionCatalogViewProps {
  readonly core: MedicalCore;
  readonly onBack: () => void;
}

function sourceLabel(source: ConditionCatalogSource): string {
  if (source.kind === 'classification') return 'Классификация МКБ-10';
  if (source.kind === 'recommendation') {
    return source.pointer ? 'Клиническая рекомендация доступна' : 'Клиническая рекомендация';
  }
  return 'Справочный материал';
}

function materialCountLabel(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word =
    mod100 >= 11 && mod100 <= 14
      ? 'материалов'
      : mod10 === 1
        ? 'материал'
        : mod10 >= 2 && mod10 <= 4
          ? 'материала'
          : 'материалов';
  return `${count} ${word}`;
}

function entryCoverage(entry: ConditionCatalogEntry): string {
  const labels: string[] = [];
  if (entry.sources.some((source) => source.kind === 'classification')) labels.push('МКБ-10');
  if (entry.sources.some((source) => source.kind === 'reference')) labels.push('справка');
  return labels.length > 0 ? labels.join(' · ') : 'Только название';
}

export function ConditionCatalogView(props: ConditionCatalogViewProps): JSX.Element {
  const initialRoute = parseConditionCatalogRoute(window.location.hash) ?? {
    section: 'diseases' as const,
    entryId: null,
  };
  const [entries, setEntries] = createSignal<readonly ConditionCatalogEntry[]>([]);
  const [section, setSection] = createSignal<ConditionCatalogSection>(initialRoute.section);
  const [entryId, setEntryId] = createSignal<string | null>(initialRoute.entryId);
  const [query, setQuery] = createSignal('');
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  const [toolbarElement, setToolbarElement] = createSignal<HTMLElement | undefined>();

  useStickySurface(toolbarElement);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await props.core.listDocuments();
      if (!result.ok) throw new Error(result.error.message);
      setEntries(buildConditionCatalog(result.value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть перечень.');
    } finally {
      setLoading(false);
    }
  };

  const syncRoute = (): void => {
    const route = parseConditionCatalogRoute(window.location.hash);
    if (!route) return;
    setSection(route.section);
    setEntryId(route.entryId);
  };

  onMount(() => {
    void refresh();
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener(CONTENT_CHANGED_EVENT, refresh);
  });
  onCleanup(() => {
    window.removeEventListener('hashchange', syncRoute);
    window.removeEventListener(CONTENT_CHANGED_EVENT, refresh);
  });

  const selectedEntry = createMemo(() => entries().find((entry) => entry.id === entryId()));
  const sectionEntries = createMemo(() => entries().filter((entry) => entry.section === section()));
  const deferredQuery = createDeferred(query, { timeoutMs: 100 });
  const visibleEntries = createMemo(() => {
    const value = deferredQuery().trim();
    if (!value) return sectionEntries();
    return sectionEntries()
      .map((entry) => ({
        entry,
        score: fuzzyQueryScore(value, [
          entry.title,
          ...entry.codes,
          ...entry.searchTerms,
          ...entry.definitions.map((definition) => definition.text),
          ...entry.sources.map((source) => source.title),
        ]),
      }))
      .filter(({ score }) => score > 0)
      .toSorted(
        (left, right) =>
          right.score - left.score || left.entry.title.localeCompare(right.entry.title, 'ru'),
      )
      .map(({ entry }) => entry);
  });
  const counts = createMemo(
    () =>
      Object.fromEntries(
        CONDITION_CATALOG_SECTIONS.map((item) => [
          item.id,
          entries().filter((entry) => entry.section === item.id).length,
        ]),
      ) as Readonly<Record<ConditionCatalogSection, number>>,
  );

  const openSection = (next: ConditionCatalogSection): void => {
    window.location.hash = conditionCatalogHash(next);
  };
  const openSource = (source: ConditionCatalogSource): void => {
    openDocumentOverlay(source.documentId);
  };
  const openEntry = (entry: ConditionCatalogEntry): void => {
    const onlySource = entry.sources.length === 1 ? entry.sources[0] : undefined;
    if (onlySource) {
      openSource(onlySource);
      return;
    }
    window.location.hash = conditionCatalogHash(entry.section, entry.id);
  };
  const closeEntry = (): void => {
    window.location.hash = conditionCatalogHash(section());
  };

  createEffect(() => {
    const entry = selectedEntry();
    const onlySource = entry?.sources.length === 1 ? entry.sources[0] : undefined;
    if (loading() || !entry || !onlySource) return;
    // Replace an old one-document selection URL so Back returns to the catalog, not a redirect.
    window.history.replaceState(window.history.state, '', conditionCatalogHash(entry.section));
    setEntryId(null);
    openSource(onlySource);
  });

  return (
    <section class="condition-catalog-page">
      <Show
        when={selectedEntry()}
        fallback={
          <>
            <Page
              class="condition-catalog-page__header"
              navigation={
                <NavBack
                  class="knowledge-back-button"
                  aria-label="К базе знаний"
                  onClick={props.onBack}
                />
              }
              breadcrumbs={
                <AppBreadcrumbs
                  items={[
                    { label: 'База знаний', href: '#/modules/documents' },
                    { label: 'Заболевания и состояния' },
                  ]}
                  onNavigate={(href) => {
                    window.location.hash = href;
                  }}
                />
              }
              icon={<AppGlyph name="book-open" class="page__icon-glyph" />}
              title={<Heading depth={1}>Заболевания и состояния</Heading>}
              description="МКБ-10, симптомы, клинические рекомендации и справочные материалы в одном перечне."
            />

            <div
              ref={setToolbarElement}
              class="condition-catalog-toolbar knowledge-subroute-heading--blurred route-sticky-chrome route-sticky-chrome--transparent"
            >
              <nav
                class="condition-catalog-tabs knowledge-subroute-heading__control"
                aria-label="Разделы перечня"
              >
                <For each={CONDITION_CATALOG_SECTIONS}>
                  {(item) => (
                    <button
                      type="button"
                      class="condition-catalog-tabs__item"
                      classList={{ 'condition-catalog-tabs__item--active': section() === item.id }}
                      aria-current={section() === item.id ? 'page' : undefined}
                      onClick={() => openSection(item.id)}
                    >
                      <span class="condition-catalog-tabs__label">{item.label}</span>
                      <span class="condition-catalog-tabs__count">{counts()[item.id]}</span>
                    </button>
                  )}
                </For>
              </nav>
              <SearchField
                class="condition-catalog-search knowledge-subroute-heading__control"
                value={query()}
                onInput={setQuery}
                onClear={() => setQuery('')}
                label={`Поиск: ${conditionSectionLabel(section()).toLowerCase()}`}
                hideLabel
                placeholder="Название, синоним или код МКБ-10"
              />
            </div>

            <section class="condition-catalog-results">
              <div class="module-collection-heading">
                <h2 class="module-collection-heading__title">{conditionSectionLabel(section())}</h2>
                <CountBadge value={visibleEntries().length} />
              </div>
              <Show when={loading()}>
                <div class="condition-catalog-empty paper-card" role="status">
                  Открываем локальный перечень…
                </div>
              </Show>
              <Show when={error()}>
                {(message) => (
                  <div class="error-card" role="alert">
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={!loading() && !error() && visibleEntries().length === 0}>
                <div class="condition-catalog-empty paper-card">
                  {query().trim()
                    ? 'Ничего не найдено в локальном перечне.'
                    : 'Для этого раздела пока нет локальных данных.'}
                </div>
              </Show>
              <div class="condition-catalog-grid">
                <LayoutVirtualizedGrid data={visibleEntries()} bufferSize={500}>
                  {(entry) => {
                    const recommendation = entry.sources.find(
                      (source) => source.kind === 'recommendation',
                    );
                    return (
                      <article class="condition-catalog-card paper-card">
                        <button
                          type="button"
                          class="condition-catalog-card__open"
                          aria-label={`Открыть карточку «${entry.title}»`}
                          onClick={() => openEntry(entry)}
                        />
                        <AppGlyph name="arrow-up-right" class="condition-catalog-card__open-icon" />
                        <Show when={entry.codes.length > 0}>
                          <span class="condition-catalog-card__code">{entry.codes.join(', ')}</span>
                        </Show>
                        <strong class="condition-catalog-card__title">{entry.title}</strong>
                        <div class="condition-catalog-card__footer">
                          <span class="condition-catalog-card__coverage">
                            {entryCoverage(entry)}
                          </span>
                          <Show when={recommendation}>
                            {(source) => (
                              <button
                                type="button"
                                class="condition-catalog-card__recommendation"
                                aria-label={`Открыть клиническую рекомендацию «${entry.title}»`}
                                onClick={() => openSource(source())}
                              >
                                <AppGlyph
                                  name="book-open"
                                  class="condition-catalog-card__recommendation-icon"
                                />
                                КР
                              </button>
                            )}
                          </Show>
                        </div>
                      </article>
                    );
                  }}
                </LayoutVirtualizedGrid>
              </div>
            </section>
          </>
        }
      >
        {(entry) => (
          <>
            <Page
              class="condition-catalog-page__header"
              navigation={
                <NavBack
                  class="knowledge-back-button"
                  aria-label={`К разделу «${conditionSectionLabel(entry().section)}»`}
                  onClick={closeEntry}
                />
              }
              breadcrumbs={
                <AppBreadcrumbs
                  items={[
                    { label: 'База знаний', href: '#/modules/documents' },
                    { label: 'Заболевания и состояния', href: CONDITION_CATALOG_HASH },
                    {
                      label: conditionSectionLabel(entry().section),
                      href: conditionCatalogHash(entry().section),
                    },
                    { label: entry().title },
                  ]}
                  onNavigate={(href) => {
                    window.location.hash = href;
                  }}
                />
              }
              icon={<AppGlyph name="book-open" class="page__icon-glyph" />}
              title={<Heading depth={3}>{entry().title}</Heading>}
              description={entry().codes.length > 0 ? `МКБ-10: ${entry().codes.join(', ')}` : null}
            />
            <For each={entry().definitions}>
              {(definition) => (
                <section class="condition-detail-definition paper-card">
                  <h2 class="condition-detail-definition__title">{definition.sourceTitle}</h2>
                  <p class="condition-detail-definition__text">{definition.text}</p>
                  <button
                    type="button"
                    class="condition-detail-definition__source"
                    onClick={() =>
                      openDocumentOverlay(definition.pointerDocumentId, definition.readerAnchor)
                    }
                  >
                    <span class="condition-detail-definition__source-label">
                      {`${definition.sourceKind === 'recommendation' ? 'Клиническая рекомендация' : 'Справочный материал'} · раздел «${definition.sourceSectionTitle}»`}
                    </span>
                    <AppGlyph
                      name="arrow-up-right"
                      class="condition-detail-definition__source-icon"
                    />
                  </button>
                </section>
              )}
            </For>
            <section class="condition-detail-materials">
              <div class="module-collection-heading">
                <h2 class="module-collection-heading__title">Материалы</h2>
                <CountBadge value={entry().sources.length} />
              </div>
              <Show
                when={entry().sources.some((source) => source.kind !== 'classification')}
                fallback={
                  <p class="condition-detail-materials__note">
                    Доступна только классификация МКБ-10. Описание состояния, диагностика и лечение
                    в подключённых источниках отсутствуют.
                  </p>
                }
              >
                <p class="condition-detail-materials__note">
                  Доступно: {materialCountLabel(entry().sources.length)} из подключённых локальных
                  источников.
                </p>
              </Show>
              <div class="condition-detail-materials__list">
                <For each={entry().sources}>
                  {(source) => (
                    <button
                      type="button"
                      class="condition-source-card paper-card"
                      onClick={() => openSource(source)}
                    >
                      <span
                        class={`condition-source-card__kind condition-source-card__kind--${source.kind}`}
                      >
                        {sourceLabel(source)}
                      </span>
                      <strong class="condition-source-card__title">{source.title}</strong>
                      <AppGlyph name="arrow-up-right" class="condition-source-card__open-icon" />
                    </button>
                  )}
                </For>
              </div>
            </section>
          </>
        )}
      </Show>
    </section>
  );
}
