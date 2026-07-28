import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  isFullTextDocumentId,
  orderDocumentSections,
  sourceTypeReaderLabel,
} from '@/features/library/document-display';
import {
  buildDocumentLinkPhrases,
  segmentTextWithMedicationLinks,
} from '@/features/library/document-medication-links';
import { DocumentRichBlock } from '@/features/library/document-rich-block';
import { readDocumentRenderBlock } from '@/features/library/document-rich-block-data';
import { openDocumentOverlay } from '@/state/document-navigation';

interface DocumentReaderDialogProps {
  readonly document: MedicalDocument | undefined;
  readonly availableDocuments?: readonly MedicalDocumentSummary[];
  readonly initialAnchor?: string | null;
  readonly onClose: () => void;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function statusLabel(status: string): string {
  if (status === 'active' || status === 'current') return 'Действующая редакция';
  if (status === 'superseded') return 'Заменённая редакция';
  if (status === 'historical') return 'Исторический документ';
  return status;
}

export function DocumentReaderDialog(props: DocumentReaderDialogProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [outlineOpen, setOutlineOpen] = createSignal(false);
  const [activeAnchor, setActiveAnchor] = createSignal(props.initialAnchor ?? '');

  const availableIds = createMemo(
    () => new Set((props.availableDocuments ?? []).map((document) => document.id)),
  );
  const documentLinks = createMemo(() =>
    buildDocumentLinkPhrases(props.availableDocuments ?? [], props.document?.id),
  );
  const fullTextDocumentId = createMemo(() => {
    const document = props.document;
    if (!document || isFullTextDocumentId(document.id)) return null;
    const fullId = `${document.id}.full`;
    return availableIds().has(fullId) ? fullId : null;
  });
  const showDocumentLinks = createMemo(() =>
    Boolean(props.document && isFullTextDocumentId(props.document.id)),
  );
  const isClinicalSummary = createMemo(
    () => props.document?.sourceType === 'clinical_recommendation_summary',
  );

  const matchingSections = createMemo(() => {
    const document = props.document;
    if (!document) return [];
    const value = normalize(query());
    const ordered = orderDocumentSections(document.sections, document.sourceType).filter(
      (section) => section.chunks.length > 0,
    );
    if (!value) return ordered;
    return ordered.filter((section) =>
      normalize(
        [
          section.title,
          section.sectionPath.join(' '),
          ...section.chunks.map((chunk) => chunk.originalText),
        ].join(' '),
      ).includes(value),
    );
  });

  const scrollTo = (anchor: string): void => {
    setActiveAnchor(anchor);
    setOutlineOpen(false);
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const close = (): void => {
    setQuery('');
    setOutlineOpen(false);
    props.onClose();
  };

  const openFullText = (): void => {
    const document = props.document;
    if (!document) return;
    const fullId = fullTextDocumentId();
    props.onClose();
    if (fullId) openDocumentOverlay(fullId);
    else window.location.hash = '#/modules/documents/recommendations';
  };

  return (
    <OverlayDialog
      open={Boolean(props.document)}
      title={props.document ? displayDocumentTitle(props.document) : 'Документ'}
      {...(props.document && displayDocumentSubtitle(props.document)
        ? { subtitle: displayDocumentSubtitle(props.document) as string }
        : {})}
      class="document-overlay"
      onClose={close}
    >
      <Show when={props.document}>
        {(documentValue) => (
          <div class="document-overlay-layout">
            <button
              type="button"
              class="document-overlay-outline-backdrop"
              classList={{ open: outlineOpen() }}
              aria-label="Закрыть оглавление"
              onClick={() => setOutlineOpen(false)}
            />
            <aside class="document-overlay-outline" classList={{ open: outlineOpen() }}>
              <header class="document-overlay-outline-header">
                <strong>Оглавление</strong>
                <button
                  type="button"
                  aria-label="Закрыть оглавление"
                  onClick={() => setOutlineOpen(false)}
                >
                  <AppGlyph name="close" />
                </button>
              </header>
              <SearchField
                class="document-overlay-search-slot"
                label="Поиск в документе"
                value={query()}
                onInput={setQuery}
                placeholder="Слово или фраза"
              />

              <details open>
                <summary>Оглавление</summary>
                <nav aria-label="Разделы документа">
                  <For each={matchingSections()}>
                    {(section, index) => (
                      <button
                        type="button"
                        classList={{ active: activeAnchor() === section.anchor }}
                        onClick={() => scrollTo(section.anchor)}
                      >
                        <span>{String(index() + 1).padStart(2, '0')}</span>
                        {section.title}
                      </button>
                    )}
                  </For>
                </nav>
              </details>

              <Show when={isClinicalSummary()}>
                <button type="button" class="document-overlay-full-text" onClick={openFullText}>
                  {fullTextDocumentId() ? 'Открыть полную версию' : 'Загрузить полную версию'}
                </button>
              </Show>

              <details class="doctor-technical-details">
                <summary>Сведения об источнике</summary>
                <dl>
                  <div>
                    <dt>Редакция</dt>
                    <dd>{documentValue().versionLabel}</dd>
                  </div>
                  <div>
                    <dt>Статус</dt>
                    <dd>{statusLabel(documentValue().status)}</dd>
                  </div>
                  <div>
                    <dt>Тип</dt>
                    <dd>{documentValue().sourceType.replaceAll('_', ' ')}</dd>
                  </div>
                </dl>
              </details>
            </aside>

            <article class="document-overlay-paper">
              <header>
                <button
                  type="button"
                  class="document-overlay-outline-toggle"
                  aria-label="Открыть оглавление"
                  onClick={() => setOutlineOpen(true)}
                >
                  <AppGlyph name="menu" />
                </button>
                <Show when={sourceTypeReaderLabel(documentValue().sourceType)}>
                  {(label) => <p>{label()}</p>}
                </Show>
                <h1>{displayDocumentTitle(documentValue())}</h1>
                <Show when={displayDocumentSubtitle(documentValue())}>
                  {(subtitle) => <p class="document-overlay-lead">{subtitle()}</p>}
                </Show>
                <Show when={isClinicalSummary()}>
                  <button
                    type="button"
                    class="document-overlay-full-text-inline"
                    onClick={openFullText}
                  >
                    {fullTextDocumentId() ? 'Открыть полную версию' : 'Загрузить полную версию'}
                  </button>
                </Show>
                <Show when={isClinicalSummary() && !fullTextDocumentId()}>
                  <p class="document-overlay-summary-note">
                    Это краткая выжимка. Полную рекомендацию можно установить из базы знаний.
                  </p>
                </Show>
              </header>

              <For each={matchingSections()}>
                {(section) => {
                  const path = () => section.sectionPath.join(' / ');
                  return (
                    <section
                      class="document-overlay-section"
                      classList={{ active: activeAnchor() === section.anchor }}
                      id={section.anchor}
                    >
                      <Show when={normalize(path()) !== normalize(section.title)}>
                        <p class="document-overlay-path">{path()}</p>
                      </Show>
                      <h2>{section.title}</h2>
                      <For each={section.chunks}>
                        {(chunk) => {
                          const renderBlock = () => readDocumentRenderBlock(chunk.metadata);
                          return (
                            <Show
                              when={renderBlock()}
                              fallback={
                                <p
                                  id={chunk.anchor}
                                  classList={{
                                    'document-initial-anchor': props.initialAnchor === chunk.anchor,
                                  }}
                                >
                                  <Show
                                    when={showDocumentLinks()}
                                    fallback={
                                      <QueryHighlightedText
                                        text={chunk.originalText}
                                        query={query()}
                                      />
                                    }
                                  >
                                    <For
                                      each={segmentTextWithMedicationLinks(
                                        chunk.originalText,
                                        documentLinks(),
                                      )}
                                    >
                                      {(segment) =>
                                        segment.kind === 'text' ? (
                                          <QueryHighlightedText
                                            text={segment.value}
                                            query={query()}
                                          />
                                        ) : (
                                          <button
                                            type="button"
                                            class="document-inline-link"
                                            onClick={() => {
                                              openDocumentOverlay(segment.documentId, null, {
                                                preferSummary: true,
                                              });
                                            }}
                                          >
                                            <QueryHighlightedText
                                              text={segment.value}
                                              query={query()}
                                            />
                                          </button>
                                        )
                                      }
                                    </For>
                                  </Show>
                                </p>
                              }
                            >
                              {(block) => (
                                <div
                                  id={chunk.anchor}
                                  classList={{
                                    'document-rich-block': true,
                                    'document-initial-anchor': props.initialAnchor === chunk.anchor,
                                  }}
                                >
                                  <DocumentRichBlock block={block()} />
                                </div>
                              )}
                            </Show>
                          );
                        }}
                      </For>
                    </section>
                  );
                }}
              </For>

              <Show when={matchingSections().length === 0}>
                <div class="document-overlay-empty">
                  <h2>Совпадений нет</h2>
                  <p>Очистите поиск внутри документа или попробуйте другую формулировку.</p>
                </div>
              </Show>
            </article>
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}
