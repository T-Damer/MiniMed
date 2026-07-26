import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
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
  buildMedicationLinkPhrases,
  segmentTextWithMedicationLinks,
} from '@/features/library/document-medication-links';
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

  const availableIds = createMemo(
    () => new Set((props.availableDocuments ?? []).map((document) => document.id)),
  );
  const medicationLinks = createMemo(() =>
    buildMedicationLinkPhrases(props.availableDocuments ?? []),
  );
  const fullTextDocumentId = createMemo(() => {
    const document = props.document;
    if (!document || isFullTextDocumentId(document.id)) return null;
    const fullId = `${document.id}.full`;
    return availableIds().has(fullId) ? fullId : null;
  });
  const showMedicationLinks = createMemo(() =>
    Boolean(props.document && isFullTextDocumentId(props.document.id)),
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
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const close = (): void => {
    setQuery('');
    props.onClose();
  };

  const openFullText = (): void => {
    const document = props.document;
    if (!document) return;
    const fullId = fullTextDocumentId();
    if (!fullId) return;
    props.onClose();
    openDocumentOverlay(fullId);
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
            <aside class="document-overlay-outline">
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
                      <button type="button" onClick={() => scrollTo(section.anchor)}>
                        <span>{String(index() + 1).padStart(2, '0')}</span>
                        {section.title}
                      </button>
                    )}
                  </For>
                </nav>
              </details>

              <Show when={fullTextDocumentId()}>
                <button type="button" class="document-overlay-full-text" onClick={openFullText}>
                  Открыть полный текст
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
                <Show when={sourceTypeReaderLabel(documentValue().sourceType)}>
                  {(label) => <p>{label()}</p>}
                </Show>
                <h1>{displayDocumentTitle(documentValue())}</h1>
                <Show when={displayDocumentSubtitle(documentValue())}>
                  {(subtitle) => <p class="document-overlay-lead">{subtitle()}</p>}
                </Show>
                <Show when={fullTextDocumentId()}>
                  <button
                    type="button"
                    class="document-overlay-full-text-inline"
                    onClick={openFullText}
                  >
                    Полный текст рекомендации
                  </button>
                </Show>
              </header>

              <For each={matchingSections()}>
                {(section) => (
                  <section class="document-overlay-section" id={section.anchor}>
                    <p class="document-overlay-path">{section.sectionPath.join(' / ')}</p>
                    <h2>{section.title}</h2>
                    <For each={section.chunks}>
                      {(chunk) => (
                        <p
                          id={chunk.anchor}
                          classList={{
                            'document-initial-anchor': props.initialAnchor === chunk.anchor,
                          }}
                        >
                          <Show when={showMedicationLinks()} fallback={chunk.originalText}>
                            <For
                              each={segmentTextWithMedicationLinks(
                                chunk.originalText,
                                medicationLinks(),
                              )}
                            >
                              {(segment) =>
                                segment.kind === 'text' ? (
                                  segment.value
                                ) : (
                                  <button
                                    type="button"
                                    class="document-inline-link"
                                    onClick={() => {
                                      props.onClose();
                                      openDocumentOverlay(segment.documentId, null, {
                                        preferSummary: true,
                                      });
                                    }}
                                  >
                                    {segment.value}
                                  </button>
                                )
                              }
                            </For>
                          </Show>
                        </p>
                      )}
                    </For>
                  </section>
                )}
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
