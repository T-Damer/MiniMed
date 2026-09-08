import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ClinicalTags } from '@/components/ClinicalTags';
import { IcdText } from '@/components/IcdText';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { Heading } from '@/components/Text';
import { preferReadableDocuments } from '@/features/library/document-display';
import { KnowledgeGraph } from '@/features/library/KnowledgeGraph';
import { searchResultDocumentKind } from '@/features/search/ScopedMedicalCore';
import { RESULT_KIND_VISUALS } from '@/features/search/searchResultKindVisuals';
import { sourceTypeLibraryLabel, specialtyLabels } from '@/i18n/labels';
import { openDocumentOverlay } from '@/state/document-navigation';
import { fuzzyQueryScore } from '@/state/fuzzy-text';

interface DocumentLibraryProps {
  readonly core: MedicalCore;
  readonly embedded?: boolean;
  readonly hideGraphControl?: boolean;
  readonly query?: string;
  readonly documents?: readonly MedicalDocumentSummary[];
}

type LibraryMode = 'list' | 'graph';

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
  const [loadedDocuments, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const documents = createMemo(() => props.documents ?? loadedDocuments());
  const [mode, setMode] = createSignal<LibraryMode>('list');
  const [filter, setFilter] = createSignal('');
  const [error, setError] = createSignal<string>();
  const [listReady, setListReady] = createSignal(
    !document.documentElement.classList.contains('using-root-view-transition'),
  );

  const deferredFilter = createDeferred(filter, { timeoutMs: 120 });
  const activeQuery = createMemo(() => props.query ?? deferredFilter());
  const searchValuesById = createMemo(
    () => new Map(documents().map((document) => [document.id, documentSearchValues(document)])),
  );

  const filteredDocuments = createMemo(() => {
    const query = activeQuery().trim();
    if (!query) return documents();
    const searchValues = searchValuesById();
    return documents()
      .map((document, index) => ({
        document,
        index,
        score: fuzzyQueryScore(query, searchValues.get(document.id) ?? []),
      }))
      .filter((entry) => entry.score > 0)
      .toSorted((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.document);
  });

  onMount(() => {
    const syncListReady = (): void => {
      setListReady(!document.documentElement.classList.contains('using-root-view-transition'));
    };
    syncListReady();
    const observer = new MutationObserver(syncListReady);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    if (props.documents !== undefined) return;
    const core = props.core;
    void (async () => {
      setError(undefined);
      const result = await core.listDocuments();
      if (!result.ok) {
        setError(result.error.message);
        setDocuments([]);
        return;
      }
      setDocuments(preferReadableDocuments(result.value));
    })();
  });

  return (
    <section
      class="archive-page"
      classList={{ 'page-surface': !props.embedded, 'page-grain': !props.embedded }}
      aria-label="Архив документов"
    >
      <Show when={!props.embedded}>
        <Page
          class="archive-library-page-header"
          icon={<AppGlyph name="book-open" class="page__icon-glyph" />}
          title={<Heading depth={1}>Документы</Heading>}
          description="Откройте рекомендации, лекарственные сведения и нормативные документы. Чтение происходит в отдельном окне поверх текущего раздела."
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
              <button
                classList={{ active: mode() === 'graph' }}
                type="button"
                disabled={documents().length === 0}
                onClick={() => setMode('graph')}
              >
                <AppGlyph name="graph" /> Карта связей
              </button>
            </fieldset>
          }
        />
      </Show>

      <Show when={props.embedded && !props.hideGraphControl}>
        <div class="library-embedded-toolbar">
          <Button
            class="library-embedded-graph-button"
            variant="primary"
            type="button"
            disabled={documents().length === 0}
            onClick={() => setMode('graph')}
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
          <span class="archive-search-meta">
            {filteredDocuments().length} из {documents().length}
          </span>
        </div>
      </Show>

      <Show when={error()}>{(message) => <div class="error-card">{message()}</div>}</Show>

      <Show when={mode() === 'graph'}>
        <Show
          when={props.embedded}
          fallback={
            <KnowledgeGraph
              documents={filteredDocuments()}
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
            subtitle={`${filteredDocuments().length} документов`}
            class="knowledge-graph-dialog"
            onClose={() => setMode('list')}
          >
            <KnowledgeGraph
              variant="dialog"
              documents={filteredDocuments()}
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
          class="document-library-grid"
          classList={{ 'document-library-grid--embedded': props.embedded }}
        >
          <Show when={filteredDocuments().length > 0 && listReady()}>
            <LayoutVirtualizedGrid data={filteredDocuments()} bufferSize={500}>
              {(document, index) => (
                <button
                  class="document-library-card catalog-card paper-card"
                  type="button"
                  onClick={() => openDocumentOverlay(document.id)}
                >
                  <span class="catalog-card__tags">
                    <span class="catalog-card__index">{String(index + 1).padStart(2, '0')}</span>
                    <AppGlyph
                      name={RESULT_KIND_VISUALS[searchResultDocumentKind(document)].icon}
                      class="unified-catalog__icon"
                    />
                    <ClinicalTags title={document.title} specialties={document.specialties} />
                  </span>
                  <strong class="catalog-card__title">
                    <IcdText text={document.title} />
                  </strong>
                  <span class="catalog-card__description">
                    {RESULT_KIND_VISUALS[searchResultDocumentKind(document)].label}
                  </span>
                </button>
              )}
            </LayoutVirtualizedGrid>
          </Show>
          <Show when={filteredDocuments().length === 0}>
            <div class="reader-empty library-empty paper-card">
              <h2>Документы не найдены</h2>
              <p>Попробуйте название заболевания, специальность или тип источника.</p>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
