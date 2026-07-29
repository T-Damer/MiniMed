import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { DocumentText } from '@/components/DocumentText';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  isFullTextDocumentId,
  orderDocumentSections,
  resolveReadableDocumentId,
  sourceTypeReaderLabel,
} from '@/features/library/document-display';
import { buildDocumentLinkPhrases } from '@/features/library/document-medication-links';
import { DocumentRichBlock } from '@/features/library/document-rich-block';
import { readDocumentRenderBlock } from '@/features/library/document-rich-block-data';
import { openDocumentOverlay } from '@/state/document-navigation';

interface DocumentReaderDialogProps {
  readonly document: MedicalDocument | undefined;
  readonly availableDocuments?: readonly MedicalDocumentSummary[];
  readonly initialAnchor?: string | null;
  readonly onRequestFullText: (document: MedicalDocument) => Promise<void>;
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
  const [fullTextPending, setFullTextPending] = createSignal(false);
  const [fullTextError, setFullTextError] = createSignal<string | null>(null);
  let outline: HTMLElement | undefined;
  let outlineNav: HTMLElement | undefined;
  let paper: HTMLElement | undefined;

  const availableIds = createMemo(
    () => new Set((props.availableDocuments ?? []).map((document) => document.id)),
  );
  const documentLinks = createMemo(() =>
    buildDocumentLinkPhrases(props.availableDocuments ?? [], props.document?.id),
  );
  const fullTextDocumentId = createMemo(() => {
    const document = props.document;
    if (!document || document.sourceType !== 'clinical_recommendation_summary') return null;
    const readableId = resolveReadableDocumentId(document.id, availableIds());
    return readableId === document.id ? null : readableId;
  });
  const showDocumentLinks = createMemo(() =>
    Boolean(
      props.document &&
        (isFullTextDocumentId(props.document.id) ||
          props.document.sourceType === 'clinical_recommendation'),
    ),
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

  createEffect(() => {
    const anchors = matchingSections().map((section) => section.anchor);
    if (!props.document || !paper || anchors.length === 0) return;
    const body = paper.closest<HTMLElement>('.overlay-dialog-body');
    const updateActiveSection = (): void => {
      if (!paper) return;
      const sections = Array.from(paper.querySelectorAll<HTMLElement>('.document-overlay-section'));
      if (sections.length === 0) return;
      const scroller = paper.scrollHeight > paper.clientHeight + 1 ? paper : (body ?? paper);
      const scrollerRect = scroller.getBoundingClientRect();
      const readingLine = scrollerRect.top + Math.min(120, scrollerRect.height * 0.2);
      let nextAnchor = sections[0]?.id ?? '';
      for (const section of sections) {
        if (section.getBoundingClientRect().top > readingLine) break;
        nextAnchor = section.id;
      }
      setActiveAnchor(nextAnchor);
    };

    paper.addEventListener('scroll', updateActiveSection, { passive: true });
    body?.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);
    queueMicrotask(updateActiveSection);
    onCleanup(() => {
      paper?.removeEventListener('scroll', updateActiveSection);
      body?.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
    });
  });

  createEffect(() => {
    const anchor = activeAnchor();
    if (!anchor || !outline || !outlineNav) return;
    queueMicrotask(() => {
      const item = outlineNav?.querySelector<HTMLElement>(`[data-section-anchor="${anchor}"]`);
      if (!outline || !item) return;
      const outlineRect = outline.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      outline.scrollTop +=
        itemRect.top - outlineRect.top - (outline.clientHeight - item.clientHeight) / 2;
    });
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

  const openFullText = async (): Promise<void> => {
    const document = props.document;
    if (!document || fullTextPending()) return;
    setFullTextPending(true);
    setFullTextError(null);
    try {
      await props.onRequestFullText(document);
    } catch (cause) {
      setFullTextError(
        cause instanceof Error ? cause.message : 'Не удалось загрузить полную рекомендацию.',
      );
    } finally {
      setFullTextPending(false);
    }
  };
  const fullTextButtonLabel = (): string =>
    fullTextPending()
      ? 'Загружаем полную версию…'
      : fullTextDocumentId()
        ? 'Открыть полную версию'
        : 'Загрузить полную версию';

  return (
    <OverlayDialog
      open={Boolean(props.document)}
      title={props.document ? displayDocumentTitle(props.document) : 'Документ'}
      {...(props.document && displayDocumentSubtitle(props.document)
        ? { subtitle: displayDocumentSubtitle(props.document) as string }
        : {})}
      class="document-overlay"
      onClose={close}
      headerStart={
        <button
          type="button"
          class="document-overlay-outline-toggle"
          aria-label="Открыть оглавление"
          onClick={() => setOutlineOpen(true)}
        >
          <AppGlyph name="menu" />
        </button>
      }
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
            <aside
              ref={outline}
              class="document-overlay-outline"
              classList={{ open: outlineOpen() }}
            >
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
                <nav ref={outlineNav} aria-label="Разделы документа">
                  <For each={matchingSections()}>
                    {(section, index) => (
                      <button
                        type="button"
                        data-section-anchor={section.anchor}
                        classList={{ active: activeAnchor() === section.anchor }}
                        aria-current={
                          activeAnchor() === section.anchor ? ('location' as const) : undefined
                        }
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
                <button
                  type="button"
                  class="document-overlay-full-text"
                  disabled={fullTextPending()}
                  onClick={() => void openFullText()}
                >
                  {fullTextButtonLabel()}
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

            <article ref={paper} class="document-overlay-paper">
              <header>
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
                    disabled={fullTextPending()}
                    onClick={() => void openFullText()}
                  >
                    {fullTextButtonLabel()}
                  </button>
                </Show>
                <Show when={fullTextError()}>
                  {(message) => (
                    <p class="document-overlay-full-text-error" role="alert">
                      {message()}
                    </p>
                  )}
                </Show>
                <Show when={isClinicalSummary() && !fullTextDocumentId()}>
                  <p class="document-overlay-summary-note">
                    Это краткая выжимка. Полная рекомендация загрузится и откроется здесь.
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
                                <div
                                  id={chunk.anchor}
                                  class="document-text-chunk"
                                  classList={{
                                    'document-initial-anchor': props.initialAnchor === chunk.anchor,
                                  }}
                                >
                                  <DocumentText
                                    text={chunk.originalText}
                                    query={query()}
                                    sourceSpans={chunk.metadata?.['sourceSpans']}
                                    documentLinks={
                                      showDocumentLinks() ? documentLinks() : undefined
                                    }
                                    onDocumentLink={(documentId) => {
                                      openDocumentOverlay(documentId, null, {
                                        preferSummary: true,
                                      });
                                    }}
                                  />
                                </div>
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
