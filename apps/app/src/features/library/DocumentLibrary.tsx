import type { MedicalCore, MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';

import { CorpusGraph } from './CorpusGraph';

interface DocumentLibraryProps {
  readonly core: MedicalCore;
}

type LibraryMode = 'folders' | 'graph';

export function DocumentLibrary(props: DocumentLibraryProps): JSX.Element {
  const [documents, setDocuments] = createSignal<readonly MedicalDocumentSummary[]>([]);
  const [selected, setSelected] = createSignal<MedicalDocument>();
  const [mode, setMode] = createSignal<LibraryMode>('folders');
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
    <section
      class="library-layout archive-library"
      classList={{ 'graph-mode': mode() === 'graph' }}
    >
      <aside class="library-list archive-cabinet">
        <div class="folder-tab">ФОНД / ДОКУМЕНТЫ</div>
        <header>
          <div>
            <p class="archive-kicker">Локальный корпус</p>
            <h1>Архив документов</h1>
            <p>
              Каждый файл хранит редакцию, структуру разделов, стабильные якоря и исходные абзацы.
              Активный пакет содержит {documents().length} документов.
            </p>
          </div>
          <div class="library-mode-switch" role="group" aria-label="Представление архива">
            <button
              type="button"
              classList={{ active: mode() === 'folders' }}
              onClick={() => setMode('folders')}
            >
              Папки
            </button>
            <button
              type="button"
              classList={{ active: mode() === 'graph' }}
              onClick={() => setMode('graph')}
            >
              Связи
            </button>
          </div>
        </header>

        <Show when={error()}>{(message) => <div class="error-card">{message()}</div>}</Show>

        <div class="cabinet-ledger">
          <span>ЕДИНИЦ ХРАНЕНИЯ</span>
          <strong>{documents().length.toString().padStart(3, '0')}</strong>
        </div>

        <Show
          when={mode() === 'folders'}
          fallback={
            <CorpusGraph
              documents={documents()}
              selectedId={selected()?.id}
              onSelect={(id) => void openDocument(id)}
            />
          }
        >
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
        </Show>
      </aside>

      <div class="library-reader source-folder">
        <div class="folder-tab source-tab">ОПИСЬ / СОДЕРЖАНИЕ</div>
        <Show
          when={selected()}
          fallback={
            <div class="reader-empty library-empty">
              <span class="empty-file-mark">LM–DOC</span>
              <p class="archive-kicker">Структура документа</p>
              <h2>{mode() === 'graph' ? 'Выберите узел документа' : 'Выберите папку слева'}</h2>
              <p>Здесь откроется полный текст с оглавлением и стабильными якорями.</p>
              <div class="empty-rules" aria-hidden="true" />
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
    </section>
  );
}
