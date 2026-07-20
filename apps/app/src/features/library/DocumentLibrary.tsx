import type { MedicalCore, MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';

import { AppGlyph } from '../../components/AppGlyph';
import { KnowledgeGraph } from './KnowledgeGraph';

interface DocumentLibraryProps {
  readonly core: MedicalCore;
}

type LibraryMode = 'list' | 'graph';

export function DocumentLibrary(props: DocumentLibraryProps): JSX.Element {
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [selected, setSelected] = createSignal<MedicalDocument>();
  const [mode, setMode] = createSignal<LibraryMode>('graph');
  const [error, setError] = createSignal<string>();

  onMount(async () => {
    const result = await props.core.listDocuments();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDocuments(result.value);
  });

  async function openDocument(id: string): Promise<void> {
    const result = await props.core.getDocument(id);
    if (result.ok) setSelected(result.value);
    else setError(result.error.message);
  }

  function scrollToSection(anchor: string): void {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section class="archive-page page-surface" aria-label="Архив документов">
      <header class="subpage-heading">
        <div>
          <p class="archive-kicker">Локальный корпус</p>
          <h1>Архив знаний</h1>
          <p>
            {documents().length || '—'} документов связаны со специальностями, разделами и
            стабильными источниками. Граф показывает структуру корпуса, список открывает полный
            текст карточки.
          </p>
        </div>
        <fieldset class="library-mode-tabs">
          <legend class="sr-only">Представление архива</legend>
          <button
            classList={{ active: mode() === 'graph' }}
            type="button"
            onClick={() => setMode('graph')}
          >
            <AppGlyph name="graph" /> Граф
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

      <Show when={error()}>{(message) => <div class="error-card">{message()}</div>}</Show>

      <Show when={mode() === 'graph'}>
        <KnowledgeGraph
          documents={documents()}
          selectedId={selected()?.id}
          onSelect={(id) => void openDocument(id)}
        />
      </Show>

      <Show when={mode() === 'list'}>
        <div class="archive-library library-embedded">
          <aside class="library-list archive-cabinet">
            <div class="cabinet-ledger">
              <span>ЕДИНИЦ ХРАНЕНИЯ</span>
              <strong>{documents().length.toString().padStart(3, '0')}</strong>
            </div>
            <div class="document-folders">
              <For each={documents()}>
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
                    <strong>{document.title}</strong>
                    <span class="folder-specialties">{document.specialties.join(' · ')}</span>
                    <small>{document.versionLabel}</small>
                  </button>
                )}
              </For>
            </div>
          </aside>

          <div class="library-reader source-folder">
            <Show
              when={selected()}
              fallback={
                <div class="reader-empty library-empty">
                  <span class="empty-file-mark">MM–DOC</span>
                  <p class="archive-kicker">Структура документа</p>
                  <h2>Выберите папку</h2>
                  <p>Здесь откроется полный текст карточки с оглавлением и стабильными якорями.</p>
                </div>
              }
            >
              {(document) => (
                <div class="document-workspace">
                  <aside class="document-outline">
                    <p class="archive-kicker">Оглавление</p>
                    <strong>{document().shortTitle ?? document().title}</strong>
                    <nav aria-label="Разделы документа">
                      <For each={document().sections}>
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
                    <For each={document().sections}>
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
                  </article>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>

      <Show when={mode() === 'graph' && selected()}>
        {(document) => (
          <div class="graph-selection paper-card">
            <div>
              <span>ВЫБРАНА ПАПКА</span>
              <strong>{document().title}</strong>
              <small>
                {document().specialties.join(' · ')} · {document().versionLabel}
              </small>
            </div>
            <button type="button" onClick={() => setMode('list')}>
              Открыть документ →
            </button>
          </div>
        )}
      </Show>
    </section>
  );
}
