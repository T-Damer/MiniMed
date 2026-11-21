import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import { createTimeSlicer } from '@localmed/search-lexical';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ClinicalTags } from '@/components/ClinicalTags';
import { IcdText } from '@/components/IcdText';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { PageSkeletonBody } from '@/components/PageSkeleton';
import { SearchField } from '@/components/SearchField';
import { Heading } from '@/components/Text';
import { displayDocumentTitle } from '@/features/library/document-display';
import { KnowledgeGraph } from '@/features/library/KnowledgeGraph';
import { selectGraphNeighborhood } from '@/features/library/knowledge-graph-model';
import { prepareNavigationDocuments } from '@/features/search/navigation-documents';
import { searchResultDocumentKind } from '@/features/search/ScopedMedicalCore';
import { RESULT_KIND_VISUALS } from '@/features/search/searchResultKindVisuals';
import { documentCountLabel, sourceTypeLibraryLabel, specialtyLabels } from '@/i18n/labels';
import { openDocumentOverlay } from '@/state/document-navigation';
import { experimentalModulesEnabled } from '@/state/experimental-modules';
import { prepareFuzzyQueryScore } from '@/state/fuzzy-text';

interface DocumentLibraryProps {
  readonly core: MedicalCore;
  readonly embedded?: boolean;
  readonly hideGraphControl?: boolean;
  readonly query?: string;
  readonly documents?: readonly MedicalDocumentSummary[];
}

type LibraryMode = 'list' | 'graph';
const PAGE_SIZE = 40;

function rememberedPage(): number {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && 'documentLibraryPage' in state) {
    const page = state.documentLibraryPage;
    if (typeof page === 'number' && Number.isSafeInteger(page) && page > 0) return page;
  }
  return 1;
}

async function orderDocuments(
  documents: readonly MedicalDocumentSummary[],
  query: string,
  signal: AbortSignal,
): Promise<readonly MedicalDocumentSummary[] | undefined> {
  const slice = createTimeSlicer();
  const score = prepareFuzzyQueryScore(query);
  const byRank = new Map<number, MedicalDocumentSummary[]>();
  for (const document of documents) {
    const rank = query
      ? score(documentSearchValues(document))
      : /^\p{L}/u.test(displayDocumentTitle(document).trim())
        ? 2
        : 1;
    if (rank > 0) {
      let bucket = byRank.get(rank);
      if (!bucket) {
        bucket = [];
        byRank.set(rank, bucket);
      }
      bucket.push(document);
    }
    const due = slice();
    if (due) await due;
    if (signal.aborted) return undefined;
  }
  return [...byRank.keys()]
    .sort((left, right) => right - left)
    .flatMap((rank) => byRank.get(rank) ?? []);
}

function documentSearchValues(document: MedicalDocumentSummary): readonly string[] {
  return [
    document.title,
    document.shortTitle ?? '',
    sourceTypeLibraryLabel(document.sourceType),
    document.versionLabel,
    ...document.specialties,
    ...specialtyLabels(document.specialties),
  ];
}

export function DocumentLibrary(props: DocumentLibraryProps): JSX.Element {
  const [loadedDocuments, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>();
  const documents = createMemo(() => props.documents ?? loadedDocuments());
  const [mode, setMode] = createSignal<LibraryMode>('list');
  const [graphShowAll, setGraphShowAll] = createSignal(false);
  const openGraph = (): void => {
    setGraphShowAll(false);
    setMode('graph');
  };
  const [filter, setFilter] = createSignal('');
  const [error, setError] = createSignal<string>();
  const [filteredDocuments, setFilteredDocuments] =
    createSignal<readonly MedicalDocumentSummary[]>();
  const [page, setPage] = createSignal(rememberedPage());
  let shownQuery: string | undefined;
  const pageCount = () => Math.max(1, Math.ceil((filteredDocuments()?.length ?? 0) / PAGE_SIZE));
  const currentPage = () => Math.min(page(), pageCount());
  const firstIndex = () => (currentPage() - 1) * PAGE_SIZE;
  const visibleDocuments = createMemo(() =>
    filteredDocuments()?.slice(firstIndex(), firstIndex() + PAGE_SIZE),
  );
  let grid: HTMLDivElement | undefined;

  const changePage = (next: number): void => {
    if (!Number.isInteger(next) || next < 1 || next > pageCount() || next === currentPage()) return;
    setPage(next);
    if (!shownQuery) {
      window.history.replaceState({ ...window.history.state, documentLibraryPage: next }, '');
    }
    grid?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };

  createEffect(() => {
    const query = (props.query ?? filter()).trim();
    const source = documents();
    if (!source) return;
    const pending = new AbortController();
    const apply = async () => {
      const ordered = await orderDocuments(source, query, pending.signal);
      if (ordered && !pending.signal.aborted) {
        batch(() => {
          if (shownQuery !== query && (shownQuery !== undefined || query)) setPage(1);
          shownQuery = query;
          setFilteredDocuments(ordered);
        });
      }
    };
    const timer = query ? window.setTimeout(() => void apply(), 120) : undefined;
    if (!query) void apply();
    onCleanup(() => {
      pending.abort();
      window.clearTimeout(timer);
    });
  });

  const graphSelection = createMemo(() => {
    if (mode() !== 'graph' || !experimentalModulesEnabled()) return { documents: [], total: 0 };
    const filtered = filteredDocuments() ?? [];
    return graphShowAll()
      ? { documents: filtered, total: filtered.length, focused: false }
      : selectGraphNeighborhood(filtered);
  });

  createEffect(() => {
    if (props.documents !== undefined) return;
    const core = props.core;
    const pending = new AbortController();
    setError(undefined);
    void (async () => {
      const result = await (core.listNavigationDocuments?.() ?? core.listDocuments());
      if (pending.signal.aborted) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const readable = await prepareNavigationDocuments(result.value, pending.signal);
      if (readable && !pending.signal.aborted) setDocuments(readable);
    })();
    onCleanup(() => pending.abort());
  });

  const pagination = (label: string) => (
    <nav class="document-library-grid__pagination" aria-label={label}>
      <Button
        class="document-library-grid__page-button"
        type="button"
        variant="icon"
        aria-label="Предыдущая страница"
        disabled={currentPage() <= 1}
        onClick={() => changePage(currentPage() - 1)}
        icon={<AppGlyph name="caret-left" />}
      />
      <label class="document-library-grid__page-number">
        <span class="sr-only">Страница</span>
        <input
          class="document-library-grid__page-input"
          inputmode="numeric"
          type="text"
          size={String(pageCount()).length}
          value={currentPage()}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            changePage(Number(event.currentTarget.value));
            event.currentTarget.value = String(currentPage());
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <span>из {pageCount()}</span>
      </label>
      <Button
        class="document-library-grid__page-button"
        type="button"
        variant="icon"
        aria-label="Следующая страница"
        disabled={currentPage() >= pageCount()}
        onClick={() => changePage(currentPage() + 1)}
        icon={<AppGlyph name="caret-right" />}
      />
    </nav>
  );

  return (
    <section
      class="archive-page"
      classList={{ 'page-surface': !props.embedded, 'page-grain': !props.embedded }}
      aria-label="Архив документов"
    >
      <Show when={!props.embedded}>
        <Page
          hero={PAGE_HEROES.library}
          class="archive-library-page-header"
          icon={<AppGlyph name="book-open" class="page__icon-glyph" />}
          title={<Heading depth={1}>Документы</Heading>}
          description="Рекомендации, лекарства и нормативные документы."
          actions={
            <fieldset class="library-mode-tabs library-mode-tabs--page-header">
              <legend class="sr-only">Представление библиотеки</legend>
              <button
                classList={{ active: mode() === 'list' }}
                type="button"
                onClick={() => setMode('list')}
              >
                <AppGlyph name="list" /> Список
              </button>
              <Show when={experimentalModulesEnabled()}>
                <button
                  classList={{ active: mode() === 'graph' }}
                  type="button"
                  disabled={!documents()?.length}
                  onClick={() => openGraph()}
                >
                  <AppGlyph name="graph" /> Карта связей
                </button>
              </Show>
            </fieldset>
          }
        />
      </Show>

      <Show when={props.embedded && !props.hideGraphControl && experimentalModulesEnabled()}>
        <div class="library-embedded-toolbar">
          <Button
            class="library-embedded-graph-button"
            variant="primary"
            type="button"
            disabled={!documents()?.length}
            onClick={() => openGraph()}
            icon={<AppGlyph name="graph" class="library-embedded-graph-button__icon" />}
          >
            Карта связей
          </Button>
        </div>
      </Show>

      <Show when={!props.embedded && props.query === undefined}>
        <div class="archive-search-row">
          <SearchField
            class="route-search"
            value={filter()}
            onInput={setFilter}
            onClear={() => setFilter('')}
            label="Поиск по документам"
            hideLabel
            placeholder="Название, специальность или источник"
          />
        </div>
      </Show>

      <Show when={error()}>{(message) => <div class="error-card">{message()}</div>}</Show>

      <Show when={mode() === 'graph' && experimentalModulesEnabled()}>
        <Show
          when={props.embedded}
          fallback={
            <KnowledgeGraph
              documents={graphSelection().documents}
              total={graphSelection().total}
              onShowAll={() => setGraphShowAll(true)}
              selectedId={undefined}
              onSelect={(id) => {
                setMode('list');
                openDocumentOverlay(id);
              }}
            />
          }
        >
          <OverlayDialog
            open
            title="Карта связей"
            subtitle={documentCountLabel(graphSelection().total)}
            class="knowledge-graph-dialog"
            presentation="screen"
            onClose={() => setMode('list')}
          >
            <KnowledgeGraph
              variant="dialog"
              documents={graphSelection().documents}
              total={graphSelection().total}
              onShowAll={() => setGraphShowAll(true)}
              selectedId={undefined}
              onSelect={(id) => {
                setMode('list');
                openDocumentOverlay(id);
              }}
            />
          </OverlayDialog>
        </Show>
      </Show>

      <Show when={mode() === 'list'}>
        <div
          ref={grid}
          class="document-library-grid"
          classList={{ 'document-library-grid--embedded': props.embedded }}
        >
          <Show when={!filteredDocuments() && !error()}>
            <div
              class="document-library-grid__loading"
              role="status"
              aria-label="Открываем список документов"
            >
              <PageSkeletonBody lines={6} />
            </div>
          </Show>
          <Show when={filteredDocuments()}>
            <div class="document-library-grid__header">
              <span class="document-library-grid__total">
                {filteredDocuments()?.length === documents()?.length
                  ? documentCountLabel(documents()?.length ?? 0)
                  : `${filteredDocuments()?.length ?? 0} из ${documentCountLabel(documents()?.length ?? 0)}`}
              </span>
              <Show when={pageCount() > 1}>{pagination('Страницы документов')}</Show>
            </div>
          </Show>
          <Show when={visibleDocuments()?.length}>
            <div class="layout-card-grid">
              <For each={visibleDocuments()}>
                {(document, index) => {
                  const visual = RESULT_KIND_VISUALS[searchResultDocumentKind(document)];
                  return (
                    <button
                      class="document-library-card catalog-card paper-card"
                      type="button"
                      onClick={() =>
                        openDocumentOverlay(document.id, null, {
                          title: displayDocumentTitle(document),
                        })
                      }
                    >
                      <span class="catalog-card__tags">
                        <span class="catalog-card__index">
                          {String(firstIndex() + index() + 1).padStart(2, '0')}
                        </span>
                        <AppGlyph name={visual.icon} class="unified-catalog__icon" />
                        <ClinicalTags title={document.title} specialties={document.specialties} />
                      </span>
                      <strong class="catalog-card__title">
                        <IcdText text={document.title} />
                      </strong>
                      <span class="catalog-card__description">{visual.label}</span>
                    </button>
                  );
                }}
              </For>
            </div>
            <Show when={pageCount() > 1}>{pagination('Страницы документов в конце списка')}</Show>
          </Show>
          <Show when={filteredDocuments()?.length === 0}>
            <div class="reader-empty library-empty paper-card">
              <h2 class="library-empty__title">Документы не найдены</h2>
              <p class="library-empty__description">
                Попробуйте название заболевания, специальность или тип источника.
              </p>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
