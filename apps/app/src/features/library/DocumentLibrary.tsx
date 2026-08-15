import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { WindowVirtualizer } from 'virtua/solid';

import { AppGlyph } from '@/components/AppGlyph';
import { ClinicalGlyph, documentClinicalSignals } from '@/components/ClinicalGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import { preferReadableDocuments } from '@/features/library/document-display';
import { KnowledgeGraph } from '@/features/library/KnowledgeGraph';
import { browserI18n } from '@/i18n/browser-i18n';
import { sourceTypeLibraryLabel, specialtyLabels } from '@/i18n/labels';
import { openDocumentOverlay } from '@/state/document-navigation';

interface DocumentLibraryProps {
  readonly core: MedicalCore;
  readonly embedded?: boolean;
}

type LibraryMode = 'list' | 'graph';

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

export function DocumentLibrary(props: DocumentLibraryProps): JSX.Element {
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [mode, setMode] = createSignal<LibraryMode>('list');
  const [filter, setFilter] = createSignal('');
  const [error, setError] = createSignal<string>();

  const filteredDocuments = createMemo(() => {
    const query = normalize(filter());
    if (!query) return documents();
    return documents().filter((document) =>
      normalize(
        [
          document.title,
          document.shortTitle ?? '',
          sourceTypeLibraryLabel(document.sourceType),
          document.versionLabel,
          ...document.specialties,
          ...specialtyLabels(document.specialties),
        ].join(' '),
      ).includes(query),
    );
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
        </div>
      </Show>

      <Show when={!props.embedded}>
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
              onSelect={(id) => openDocumentOverlay(id)}
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
              documents={filteredDocuments()}
              selectedId={undefined}
              onSelect={(id) => openDocumentOverlay(id)}
            />
          </OverlayDialog>
        </Show>
      </Show>

      <Show when={mode() === 'list'}>
        <div class="document-library-grid">
          <Show when={filteredDocuments().length > 0}>
            <WindowVirtualizer data={filteredDocuments()} bufferSize={500}>
              {(document, index) => (
                <button
                  class="document-library-card paper-card"
                  type="button"
                  onClick={() => openDocumentOverlay(document.id)}
                >
                  <span class="document-library-index">{String(index() + 1).padStart(2, '0')}</span>
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
            </WindowVirtualizer>
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
