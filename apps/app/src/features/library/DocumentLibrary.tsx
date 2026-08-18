import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ClinicalGlyph, documentClinicalSignals } from '@/components/ClinicalGlyph';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import { preferReadableDocuments } from '@/features/library/document-display';
import { KnowledgeGraph } from '@/features/library/KnowledgeGraph';
import { browserI18n } from '@/i18n/browser-i18n';
import { sourceTypeLibraryLabel, specialtyLabels } from '@/i18n/labels';
import { openDocumentOverlay } from '@/state/document-navigation';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

interface DocumentLibraryProps {
  readonly core: MedicalCore;
  readonly embedded?: boolean;
  readonly query?: string;
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
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [mode, setMode] = createSignal<LibraryMode>('list');
  const [filter, setFilter] = createSignal('');
  const [error, setError] = createSignal<string>();
  const [listReady, setListReady] = createSignal(
    !document.documentElement.classList.contains('using-root-view-transition'),
  );

  const activeQuery = createMemo(() => props.query ?? filter());

  const filteredDocuments = createMemo(() => {
    const query = activeQuery().trim();
    if (!query) return documents();
    return documents().filter((document) =>
      matchesFuzzyQuery(query, documentSearchValues(document)),
    );
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
        <header class="subpage-heading archive-library-heading">
          <div>
            <p class="archive-kicker">Локальная медицинская библиотека</p>
            <h1>Документы</h1>
            <p>
              Откройте рекомендации, лекарственные сведения и нормативные документы. Чтение
              происходит в отдельном окне поверх текущего раздела.
            </p>
          </div>
          <fieldset class="library-mode-tabs">
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
              onClick={() => setMode('graph')}
            >
              <AppGlyph name="graph" /> Карта связей
            </button>
          </fieldset>
        </header>
      </Show>

      <Show when={props.embedded}>
        <div class="library-embedded-toolbar">
          <Button
            class="library-embedded-graph-button"
            variant="primary"
            type="button"
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
        <div class="document-library-grid">
          <Show when={filteredDocuments().length > 0 && listReady()}>
            <LayoutVirtualizedGrid data={filteredDocuments()} bufferSize={500}>
              {(document, index) => (
                <button
                  class="document-library-card paper-card"
                  type="button"
                  onClick={() => openDocumentOverlay(document.id)}
                >
                  <span class="document-library-index">{String(index + 1).padStart(2, '0')}</span>
                  <span class="document-library-copy">
                    <small>{sourceTypeLibraryLabel(document.sourceType)}</small>
                    <strong>{document.title}</strong>
                    <span>
                      {specialtyLabels(document.specialties).join(' · ') ||
                        browserI18n.getMessage('specialty_general_medicine')}
                    </span>
                    <em>Редакция {document.versionLabel}</em>
                  </span>
                  <span class="clinical-signals" aria-hidden="true">
                    <For each={documentClinicalSignals(document).slice(0, 3)}>
                      {(signal) => (
                        <span
                          class={`clinical-signal ${signal.strength} tone-${signal.tone}`}
                          title={signal.label}
                        >
                          <ClinicalGlyph name={signal.icon} />
                        </span>
                      )}
                    </For>
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
