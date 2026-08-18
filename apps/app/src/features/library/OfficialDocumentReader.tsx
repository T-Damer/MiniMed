import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DocumentCrumbs } from '@/components/DocumentCrumbs';
import { DocumentText } from '@/components/DocumentText';
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
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import { DocumentRichBlock } from '@/features/library/document-rich-block';
import { readDocumentRenderBlock } from '@/features/library/document-rich-block-data';
import { buildDocumentSectionLink, openDocumentOverlay } from '@/state/document-navigation';
import type { DocumentTrail } from '@/state/document-trail';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

interface OfficialDocumentReaderProps {
  readonly document: MedicalDocument | undefined;
  readonly pendingTitle?: string;
  readonly availableDocuments?: readonly MedicalDocumentSummary[];
  readonly initialAnchor?: string | null;
  readonly trail: DocumentTrail | null;
  readonly openError?: string | null;
  readonly onNavigate: (href: string) => void;
  readonly onRequestFullText: (document: MedicalDocument) => Promise<void>;
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

export function OfficialDocumentReader(props: OfficialDocumentReaderProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [fullTextPending, setFullTextPending] = createSignal(false);
  const [fullTextError, setFullTextError] = createSignal<string | null>(null);
  let flashTimeout: number | undefined;
  let flashedHeading: HTMLElement | null = null;

  const matchingSections = createMemo(() => {
    const document = props.document;
    if (!document) return [];
    const value = query().trim();
    const ordered = orderDocumentSections(document.sections, document.sourceType).filter(
      (section) => section.chunks.length > 0,
    );
    if (!value) return ordered;
    return ordered.filter((section) =>
      matchesFuzzyQuery(value, [
        section.title,
        section.sectionPath.join(' '),
        ...section.chunks.map((chunk) => chunk.originalText),
      ]),
    );
  });

  const chrome = useDocumentReaderChrome({
    ...(props.initialAnchor != null && props.initialAnchor !== ''
      ? { initialAnchor: props.initialAnchor }
      : {}),
    sectionSelector: '.document-overlay-section',
    outlineItemAttr: 'data-section-anchor',
    scrollSpyWhen: () => Boolean(props.document) && matchingSections().length > 0,
    onScrollTo: (_anchor, section) => {
      const heading = section?.querySelector<HTMLElement>('.document-overlay-section__title');
      if (heading) {
        if (flashTimeout !== undefined) {
          window.clearTimeout(flashTimeout);
          flashedHeading?.classList.remove('document-overlay-section__title--flash');
        }
        heading.classList.add('document-overlay-section__title--flash');
        flashedHeading = heading;
        flashTimeout = window.setTimeout(() => {
          heading.classList.remove('document-overlay-section__title--flash');
          if (flashedHeading === heading) flashedHeading = null;
          flashTimeout = undefined;
        }, 1200);
      }
    },
  });

  onMount(() => {
    requestAnimationFrame(() => {
      const anchor = props.initialAnchor;
      const target = anchor ? document.getElementById(anchor) : null;
      const paper = document.querySelector<HTMLElement>('.document-overlay-paper');
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

  const copySectionLink = async (documentId: string, sectionAnchor: string): Promise<void> => {
    const url = buildDocumentSectionLink(documentId, sectionAnchor);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать ссылку на раздел.');
    }
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

  const pageTitle = (): string =>
    props.document
      ? displayDocumentTitle(props.document)
      : (props.pendingTitle ?? props.openError ?? 'Документ');

  return (
    <DocumentReaderChromeShell
      ariaLabel={pageTitle()}
      class="document-page document-overlay page-surface page-grain"
      classList={{ 'document-overlay--loading': !props.document }}
      chrome={chrome}
      trail={props.trail}
      onNavigate={props.onNavigate}
      breadcrumbs={
        <Show when={props.trail}>
          {(currentTrail) => (
            <DocumentCrumbs trail={currentTrail()} onNavigate={props.onNavigate} />
          )}
        </Show>
      }
      printButton={
        <Show when={props.document}>
          {(documentValue) => (
            <Button
              type="button"
              variant="icon"
              class="document-page__print overlay-dialog__print-button"
              aria-label="Печать документа"
              title="Печать документа"
              onClick={() => {
                if (!printDocument(documentValue())) {
                  toast.error('Не удалось открыть окно печати.');
                }
              }}
              icon={<AppGlyph name="printer" class="overlay-dialog__button-icon" />}
            />
          )}
        </Show>
      }
      bodyError={
        <Show when={props.openError}>
          {(message) => (
            <div class="document-page__error" role="alert">
              <p>{message()}</p>
            </div>
          )}
        </Show>
      }
      showLayout={!props.openError}
      loadingBody={undefined}
      outlineSearchSlot={
        <Show when={props.document}>
          <SearchField
            class={`document-overlay-search-slot${chrome.outlineSearchStuck() ? ' document-overlay-search-slot--stuck' : ''}`}
            label="Поиск в документе"
            value={query()}
            onInput={setQuery}
            placeholder="Слово или фраза"
          />
          <p class="document-overlay-outline-label">Оглавление</p>
        </Show>
      }
      outlineNav={
        <For each={matchingSections()}>
          {(section, index) => {
            const headingTag = documentSectionHeadingTag(section.depth);
            return (
              <button
                type="button"
                data-section-anchor={section.anchor}
                class={`document-overlay-outline-section-button document-overlay-outline-section-button--${headingTag}`}
                classList={{
                  'document-overlay-outline-section-button--active':
                    chrome.activeAnchor() === section.anchor,
                }}
                aria-current={chrome.activeAnchor() === section.anchor ? 'location' : undefined}
                onClick={() => chrome.scrollTo(section.anchor)}
              >
                <span class="document-overlay-outline-section-number">
                  {String(index() + 1).padStart(2, '0')}
                </span>
                {section.title}
              </button>
            );
          }}
        </For>
      }
      outlineFooter={
        <Show when={props.document}>
          {(documentValue) => (
            <>
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
            </>
          )}
        </Show>
      }
      content={
        <article ref={chrome.setPaper} class="document-overlay-paper">
          <Show when={!props.document && !props.openError}>
            <div class="document-overlay-spinner-overlay" role="status" aria-live="polite">
              <span class="document-overlay-spinner" aria-hidden="true" />
            </div>
          </Show>
          <Show when={props.document}>
            {(documentValue) => (
              <>
                <Show when={fullTextPending()}>
                  <div class="document-overlay-spinner-overlay" role="status" aria-live="polite">
                    <span class="document-overlay-spinner" aria-hidden="true" />
                    <p class="document-overlay-spinner-caption">
                      Это может занять несколько секунд для больших КР.
                    </p>
                  </div>
                </Show>
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
                      <Button
                        type="button"
                        class="document-overlay-action-button"
                        aria-label="Распечатать памятку"
                        onClick={() => {
                          if (!printDocument(documentValue())) {
                            toast.error('Не удалось открыть окно печати.');
                          }
                        }}
                        icon={
                          <AppGlyph name="printer" class="document-overlay-action-button__icon" />
                        }
                      >
                        Распечатать
                      </Button>
                      <Button
                        type="button"
                        class="document-overlay-action-button"
                        aria-label="Поделиться памяткой"
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
                        icon={
                          <AppGlyph name="share" class="document-overlay-action-button__icon" />
                        }
                      >
                        Поделиться
                      </Button>
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
                          'document-overlay-section--active':
                            chrome.activeAnchor() === section.anchor,
                        }}
                        id={section.anchor}
                      >
                        <Show when={normalize(path()) !== normalize(section.title)}>
                          <p class="document-overlay-path">{path()}</p>
                        </Show>
                        <Dynamic
                          component={documentSectionHeadingTag(section.depth)}
                          class={`document-overlay-section__title document-overlay-section__title--${documentSectionHeadingTag(section.depth)} document-overlay-section__title--copy`}
                          classList={{
                            'document-overlay-section__title--active':
                              chrome.activeAnchor() === section.anchor,
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={`Скопировать ссылку на раздел «${section.title}»`}
                          onClick={() => void copySectionLink(documentValue().id, section.anchor)}
                          onKeyDown={(event: KeyboardEvent) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              void copySectionLink(documentValue().id, section.anchor);
                            }
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
                                      'document-initial-anchor':
                                        props.initialAnchor === chunk.anchor,
                                    }}
                                  >
                                    <DocumentText
                                      text={chunk.originalText}
                                      query={query()}
                                      fuzzyQuery
                                      highlightClass="document-overlay-match"
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
                                      'document-initial-anchor':
                                        props.initialAnchor === chunk.anchor,
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
                    <h2 class="document-overlay-empty__title">Совпадений нет</h2>
                    <p class="document-overlay-empty__text">
                      Очистите поиск внутри документа или попробуйте другую формулировку.
                    </p>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </article>
      }
    />
  );
}
