import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';

import { AppGlyph } from '../../components/AppGlyph';
import { ClinicalGlyph, documentClinicalSignals } from '../../components/ClinicalGlyph';
import { openDocumentOverlay } from '../../state/document-navigation';
import { KnowledgeGraph } from './KnowledgeGraph';

interface DocumentLibraryProps {
  readonly core: MedicalCore;
}

type LibraryMode = 'list' | 'graph';

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function sourceTypeLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    clinical_recommendation_summary: 'Клинические рекомендации',
    official_registry_summary: 'Официальный реестр лекарств',
    regulatory_act: 'Нормативный документ',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
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
          sourceTypeLabel(document.sourceType),
          document.versionLabel,
          ...document.specialties,
        ].join(' '),
      ).includes(query),
    );
  });

  onMount(async () => {
    const result = await props.core.listDocuments();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDocuments(result.value);
  });

  return (
    <section class="archive-page page-surface" aria-label="Архив документов">
      <header class="subpage-heading archive-library-heading">
        <div>
          <p class="archive-kicker">Локальная медицинская библиотека</p>
          <h1>Документы</h1>
          <p>
            Откройте рекомендации, лекарственные сведения и нормативные документы. Чтение происходит
            в отдельном окне поверх текущего раздела.
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

      <div class="library-toolbar">
        <label class="library-search">
          <AppGlyph name="search" />
          <span class="sr-only">Поиск по документам</span>
          <input
            value={filter()}
            onInput={(event) => setFilter(event.currentTarget.value)}
            placeholder="Название, специальность или источник"
            autocomplete="off"
          />
        </label>
        <span class="library-search-count">
          {filteredDocuments().length} из {documents().length}
        </span>
      </div>

      <Show when={error()}>{(message) => <div class="error-card">{message()}</div>}</Show>

      <Show when={mode() === 'graph'}>
        <KnowledgeGraph
          documents={filteredDocuments()}
          selectedId={undefined}
          onSelect={(id) => openDocumentOverlay(id)}
        />
      </Show>

      <Show when={mode() === 'list'}>
        <div class="document-library-grid">
          <For each={filteredDocuments()}>
            {(document, index) => (
              <button
                class="document-library-card paper-card"
                type="button"
                onClick={() => openDocumentOverlay(document.id)}
              >
                <span class="document-library-index">{String(index() + 1).padStart(2, '0')}</span>
                <span class="document-library-copy">
                  <small>{sourceTypeLabel(document.sourceType)}</small>
                  <strong>{document.title}</strong>
                  <span>{document.specialties.join(' · ') || 'Общая медицина'}</span>
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
                <span class="document-library-open">Открыть</span>
              </button>
            )}
          </For>
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
