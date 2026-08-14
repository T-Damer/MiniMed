import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
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
import { Dynamic } from 'solid-js/web';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { DocumentText } from '@/components/DocumentText';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  documentSectionHeadingTag,
  isFullTextDocumentId,
  orderDocumentSections,
  resolveReadableDocumentId,
  sourceTypeReaderLabel,
} from '@/features/library/document-display';
import { buildDocumentLinkPhrases } from '@/features/library/document-medication-links';
import { printDocument, shareDocument } from '@/features/library/document-print';
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

  onMount(() => {
    if (window.matchMedia('(min-width: 761px)').matches) setOutlineOpen(true);
    requestAnimationFrame(() => {
      const anchor = props.initialAnchor;
      const target = anchor ? document.getElementById(anchor) : null;
      if (target) {
        target.scrollIntoView({ behavior: 'instant', block: 'start' });
      } else {
        paper?.scrollTo({ top: 0, behavior: 'instant' });
      }
    });
  });

  const availableIds = createMemo(
    () => new Set((props.availableDocuments ?? []).map((document) => document.id)),
  );
  const documentLinks = createMemo(() =>
    buildDocumentLinkPhrases(props.availableDocuments ?? [], props.document?.id),
  );
  const fullTextDocumentId = createMemo(() => {
    const document = props.document;
    if (document?.sourceType !== 'clinical_recommendation_summary') return null;
    const readableId = resolveReadableDocumentId(document.id, availableIds());
    return readableId === document.id ? null : readableId;
  });
  const showDocumentLinks = createMemo(() =>
    Boolean(
      props.document &&
        (isFullTextDocumentId(props.document.id) ||
          props.document.sourceType === 'clinical_recommendation' ||
          props.document.sourceType === 'medical_reference' ||
          props.document.sourceType === 'rls_mkb_reference'),
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
    if (!window.matchMedia('(min-width: 761px)').matches) setOutlineOpen(false);
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({
        behavior: window.matchMedia('(min-width: 761px)').matches ? 'smooth' : 'instant',
        block: 'start',
      });
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
        ? 'Полный текст'
        : 'Загрузить полный текст';

  return (
    <OverlayDialog
      open={Boolean(props.document)}
      title={props.document ? displayDocumentTitle(props.document) : 'Документ'}
      {...(props.document && displayDocumentSubtitle(props.document)
        ? { subtitle: displayDocumentSubtitle(props.document) as string }
        : {})}
      class="document-overlay"
      bodyClass="document-overlay__body"
      onClose={close}
      headerStart={
        <button
          type="button"
          class="document-overlay-outline-toggle"
          aria-label={outlineOpen() ? 'Скрыть оглавление' : 'Открыть оглавление'}
          aria-expanded={outlineOpen()}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          <AppGlyph name="menu" class="document-overlay-outline-toggle__icon" />
        </button>
      }
    >
      <Show when={props.document}>
        {(documentValue) => (
          <div
            class="document-overlay-layout"
            classList={{ 'document-overlay-layout--outline-hidden': !outlineOpen() }}
          >
            <button
              type="button"
              class="document-overlay-outline-backdrop"
              classList={{ 'document-overlay-outline-backdrop--open': outlineOpen() }}
              aria-label="Закрыть оглавление"
              onClick={() => setOutlineOpen(false)}
            />
            <aside
              ref={outline}
              class="document-overlay-outline"
              classList={{
                'document-overlay-outline--hidden': !outlineOpen(),
                'document-overlay-outline--open': outlineOpen(),
              }}
            >
              <header class="document-overlay-outline-header">
                <strong>Оглавление</strong>
                <button
                  type="button"
                  class="document-overlay-outline-header__close-button"
                  aria-label="Закрыть оглавление"
                  onClick={() => setOutlineOpen(false)}
                >
                  <AppGlyph name="close" class="document-overlay-outline-header__close-icon" />
                </button>
              </header>
              <SearchField
                class="document-overlay-search-slot"
                label="Поиск в документе"
                value={query()}
                onInput={setQuery}
                placeholder="Слово или фраза"
              />

              <details class="document-overlay-outline-details" open>
                <summary class="document-overlay-outline-summary">Оглавление</summary>
                <nav
                  ref={outlineNav}
                  class="document-overlay-outline-nav"
                  aria-label="Разделы документа"
                >
                  <For each={matchingSections()}>
                    {(section, index) => (
                      <button
                        type="button"
                        data-section-anchor={section.anchor}
                        class="document-overlay-outline-section-button"
                        classList={{
                          'document-overlay-outline-section-button--active':
                            activeAnchor() === section.anchor,
                        }}
                        aria-current={
                          activeAnchor() === section.anchor ? ('location' as const) : undefined
                        }
                        onClick={() => scrollTo(section.anchor)}
                      >
                        <span class="document-overlay-outline-section-number">
                          {String(index() + 1).padStart(2, '0')}
                        </span>
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
              <header class="document-overlay-paper__header">
                <Show when={sourceTypeReaderLabel(documentValue().sourceType)}>
                  {(label) => <p class="document-overlay-paper__source-label">{label()}</p>}
                </Show>
                <h1 class="document-overlay-paper__title">
                  {displayDocumentTitle(documentValue())}
                </h1>
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
                <Show when={documentValue().sourceType === 'medical_reference'}>
                  <div class="document-overlay-paper__actions">
                    <button
                      type="button"
                      class="document-overlay-action-button"
                      onClick={() => {
                        if (!printDocument(documentValue())) {
                          toast.error('Не удалось открыть окно печати.');
                        }
                      }}
                    >
                      <AppGlyph name="printer" class="document-overlay-action-button__icon" />
                      Распечатать
                    </button>
                    <button
                      type="button"
                      class="document-overlay-action-button"
                      onClick={() => {
                        shareDocument(documentValue())
                          .then((mode) => {
                            toast.success(
                              mode === 'shared'
                                ? 'Памятка передана.'
                                : 'Памятка скопирована в буфер обмена.',
                            );
                          })
                          .catch(() => toast.error('Не удалось поделиться памяткой.'));
                      }}
                    >
                      <AppGlyph name="share" class="document-overlay-action-button__icon" />
                      Поделиться
                    </button>
                  </div>
                </Show>
              </header>

              <For each={matchingSections()}>
                {(section) => {
                  const path = () => section.sectionPath.join(' / ');
                  return (
                    <section
                      class="document-overlay-section"
                      classList={{
                        'document-overlay-section--active': activeAnchor() === section.anchor,
                      }}
                      id={section.anchor}
                    >
                      <Show when={normalize(path()) !== normalize(section.title)}>
                        <p class="document-overlay-path">{path()}</p>
                      </Show>
                      <Dynamic
                        component={documentSectionHeadingTag(section.depth)}
                        class={`document-overlay-section__title document-overlay-section__title--${documentSectionHeadingTag(section.depth)}`}
                        classList={{
                          'document-overlay-section__title--active':
                            activeAnchor() === section.anchor,
                        }}
                      >
                        {section.title}
                      </Dynamic>
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
                                    paragraphClass="document-overlay-section__paragraph"
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
