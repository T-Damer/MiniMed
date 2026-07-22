import type { MedicalCore, MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';

import { AppGlyph } from '../../components/AppGlyph';
import { ClinicalGlyph, documentClinicalSignals } from '../../components/ClinicalGlyph';
import { KnowledgeGraph } from './KnowledgeGraph';

interface DocumentLibraryProps {
  readonly core: MedicalCore;
}

type LibraryMode = 'list' | 'graph';

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

export function DocumentLibrary(props: DocumentLibraryProps): JSX.Element {
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [selected, setSelected] = createSignal<MedicalDocument>();
  const [mode, setMode] = createSignal<LibraryMode>('list');
  const [filter, setFilter] = createSignal('');
  const [documentQuery, setDocumentQuery] = createSignal('');
  const [error, setError] = createSignal<string>();
  let readerRoot: HTMLDivElement | undefined;

  const filteredDocuments = createMemo(() => {
    const query = normalize(filter());
    if (!query) return documents();
    return documents().filter((document) =>
      normalize(
        [
          document.title,
          document.shortTitle ?? '',
          document.sourceType,
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

  async function openDocument(id: string, scroll = true): Promise<void> {
    const result = await props.core.getDocument(id);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSelected(result.value);
    setDocumentQuery('');
    if (scroll) {
      requestAnimationFrame(() => readerRoot?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  async function openFromGraph(id: string): Promise<void> {
    await openDocument(id, false);
    setMode('list');
    requestAnimationFrame(() => readerRoot?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function closeDocument(): void {
    setSelected(undefined);
    setDocumentQuery('');
  }

  function scrollToSection(anchor: string): void {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function sectionMatches(section: MedicalDocument['sections'][number]): boolean {
    const query = normalize(documentQuery());
    if (!query) return true;
    return normalize(
      [section.title, section.sectionPath.join(' '), ...section.chunks.map((chunk) => chunk.originalText)].join(
        ' ',
      ),
    ).includes(query);
  }

  return (
    <section class="archive-page page-surface" aria-label="Архив документов">
      <header class="subpage-heading">
        <div>
          <p class="archive-kicker">Локальный корпус</p>
          <h1>Архив знаний</h1>
          <p>
            {documents().length || '—'} документов связаны со специальностями и источниками. Список
            предназначен для быстрого открытия; карта показывает клинические области без скрытых узлов.
          </p>
        </div>
        <fieldset class="library-mode-tabs">
          <legend class="sr-only">Представление архива</legend>
          <button
            classList={{ active: mode() === 'graph' }}
            type="button"
            onClick={() => setMode('graph')}
          >
            <AppGlyph name="graph" /> Карта
          </button>
          <button
            classList={{ active: mode() === 'list' }}
            type="button"
            onClick={() => setMode('list')}
          >
            <AppGlyph name="list" /> Список
          </button>
        </fieldset>
      </header>

      <div class="library-toolbar">
        <label class="library-search">
          <AppGlyph name="search" />
          <span class="sr-only">Поиск по архиву</span>
          <input
            value={filter()}
            onInput={(event) => setFilter(event.currentTarget.value)}
            placeholder="Название, специальность, тип источника…"
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
          selectedId={selected()?.id}
          onSelect={(id) => void openFromGraph(id)}
        />
      </Show>

      <Show when={mode() === 'list'}>
        <div class="archive-library library-embedded">
          <aside class="library-list archive-cabinet">
            <div class="cabinet-ledger">
              <span>НАЙДЕНО</span>
              <strong>{filteredDocuments().length.toString().padStart(3, '0')}</strong>
            </div>
            <div class="document-folders">
              <For each={filteredDocuments()}>
                {(document, index) => (
                  <button
                    class="document-folder"
                    classList={{ selected: selected()?.id === document.id }}
                    type="button"
                    onClick={() => void openDocument(document.id)}
                  >
                    <span class="document-folder-tab">
                      {String(index() + 1).padStart(2, '0')} /{' '}
                      {document.sourceType.replaceAll('_', ' ')}
                    </span>
                    <span class="document-folder-main">
                      <strong>{document.title}</strong>
                      <span class="clinical-signals" aria-label="Клинические области">
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
                    </span>
                    <span class="folder-specialties">{document.specialties.join(' · ')}</span>
                    <small>{document.versionLabel}</small>
                  </button>
                )}
              </For>
              <Show when={filteredDocuments().length === 0}>
                <div class="reader-empty library-empty">
                  <p class="archive-kicker">Архив</p>
                  <h2>Ничего не найдено</h2>
                  <p>Попробуйте название заболевания, специальность или тип документа.</p>
                </div>
              </Show>
            </div>
          </aside>

          <div
            class="library-reader source-folder"
            ref={(element) => {
              readerRoot = element;
            }}
          >
            <Show
              when={selected()}
              fallback={
                <div class="reader-empty library-empty">
                  <span class="empty-file-mark">MM–DOC</span>
                  <p class="archive-kicker">Структура документа</p>
                  <h2>Выберите документ</h2>
                  <p>Одно нажатие откроет карточку, оглавление и доступный полный текст.</p>
                </div>
              }
            >
              {(document) => (
                <div class="document-workspace">
                  <div class="reader-toolbar document-reader-toolbar">
                    <strong>{document().shortTitle ?? document().title}</strong>
                    <input
                      value={documentQuery()}
                      onInput={(event) => setDocumentQuery(event.currentTarget.value)}
                      placeholder="Поиск внутри документа"
                      aria-label="Поиск внутри открытого документа"
                    />
                    <button
                      class="reader-close"
                      type="button"
                      aria-label="Закрыть документ"
                      onClick={closeDocument}
                    >
                      <AppGlyph name="close" />
                    </button>
                  </div>

                  <aside class="document-outline">
                    <p class="archive-kicker">Оглавление</p>
                    <strong>{document().shortTitle ?? document().title}</strong>
                    <nav aria-label="Разделы документа">
                      <For each={document().sections.filter(sectionMatches)}>
                        {(section, index) => (
                          <button type="button" onClick={() => scrollToSection(section.anchor)}>
                            <span>{String(index() + 1).padStart(2, '0')}</span>
                            {section.title}
                          </button>
                        )}
                      </For>
                    </nav>
                  </aside>

                  <article class="document-reader paper-sheet">
                    <span class="paper-clip" aria-hidden="true" />
                    <header class="document-cover">
                      <p class="archive-kicker">{document().sourceType.replaceAll('_', ' ')}</p>
                      <h2>{document().title}</h2>
                      <dl>
                        <div>
                          <dt>Редакция</dt>
                          <dd>{document().versionLabel}</dd>
                        </div>
                        <div>
                          <dt>Статус</dt>
                          <dd>{document().status}</dd>
                        </div>
                        <div>
                          <dt>Разделов</dt>
                          <dd>{document().sections.length}</dd>
                        </div>
                      </dl>
                    </header>
                    <For each={document().sections.filter(sectionMatches)}>
                      {(section, index) => (
                        <section class="document-section" id={section.anchor}>
                          <div class="section-number">{String(index() + 1).padStart(2, '0')}</div>
                          <div class="section-copy">
                            <span class="section-type">{section.sectionType ?? 'section'}</span>
                            <h3>{section.sectionPath.join(' / ')}</h3>
                            <For each={section.chunks}>
                              {(chunk) => <p id={chunk.anchor}>{chunk.originalText}</p>}
                            </For>
                          </div>
                        </section>
                      )}
                    </For>
                    <Show when={document().sections.filter(sectionMatches).length === 0}>
                      <div class="reader-empty">
                        <h2>В документе нет такого текста</h2>
                        <p>Очистите локальный поиск или используйте другое медицинское выражение.</p>
                      </div>
                    </Show>
                  </article>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
