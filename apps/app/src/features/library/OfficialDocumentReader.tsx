import type { MedicalDocument, MedicalDocumentSummary, TextRange } from '@localmed/contracts';
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
import { Button } from '@/components/Button';
import { DocumentCrumbs } from '@/components/DocumentCrumbs';
import { DocumentText, documentTextSearchText } from '@/components/DocumentText';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { DocumentFindBar, type DocumentFindResultState } from '@/features/library/DocumentFindBar';
import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  documentSectionHeadingTag,
  isFullTextDocumentId,
  nestDocumentSections,
  resolveReadableDocumentId,
  sourceTypeReaderLabel,
  visibleReaderSections,
} from '@/features/library/document-display';
import {
  type DocumentFindUnit,
  hasSearchableDocumentUnits,
  rangesForFindUnit,
} from '@/features/library/document-find';
import {
  buildDocumentLinkPhrases,
  createDocumentLinkMatcher,
} from '@/features/library/document-medication-links';
import { printDocument, shareDocument } from '@/features/library/document-print';
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import { DocumentRichBlock } from '@/features/library/document-rich-block';
import {
  documentRenderBlockSearchText,
  resolveDocumentChunkItems,
} from '@/features/library/document-rich-block-data';
import { buildDocumentSectionLink, openDocumentOverlay } from '@/state/document-navigation';
import type { DocumentTrail } from '@/state/document-trail';

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

const emptyFindState: DocumentFindResultState = {
  query: '',
  mode: 'exact',
  matches: [],
  activeIndex: 0,
  loading: false,
};

const INITIAL_SECTION_BATCH = 4;
const SECTION_BATCH_SIZE = 3;

function sectionIndexForAnchor(
  sections: ReturnType<typeof visibleReaderSections>,
  anchor: string | null | undefined,
): number {
  if (!anchor) return -1;
  return sections.findIndex(
    (section) =>
      section.anchor === anchor || section.chunks.some((chunk) => chunk.anchor === anchor),
  );
}

function scheduleIdleWork(work: () => void): number {
  const requestIdleCallback = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(work, { timeout: 100 });
  }
  return window.setTimeout(work, 0);
}

function cancelIdleWork(handle: number): void {
  const cancelIdleCallback = (
    globalThis as typeof globalThis & { cancelIdleCallback?: (handle: number) => void }
  ).cancelIdleCallback;
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}

export function OfficialDocumentReader(props: OfficialDocumentReaderProps): JSX.Element {
  const [findState, setFindState] = createSignal<DocumentFindResultState>(emptyFindState);
  const [findOpen, setFindOpen] = createSignal(false);
  const [fullTextPending, setFullTextPending] = createSignal(false);
  const [fullTextError, setFullTextError] = createSignal<string | null>(null);
  const [mountedSectionCount, setMountedSectionCount] = createSignal(0);
  let flashTimeout: number | undefined;
  let flashedHeading: HTMLElement | null = null;

  const orderedSections = createMemo(() => {
    const document = props.document;
    if (!document) return [];
    return visibleReaderSections(document.sections, document.sourceType);
  });

  const visibleSections = createMemo(() => orderedSections().slice(0, mountedSectionCount()));
  const visibleSectionTree = createMemo(() => nestDocumentSections(visibleSections()));
  const sectionsPending = createMemo(
    () => mountedSectionCount() > 0 && mountedSectionCount() < orderedSections().length,
  );

  createEffect(() => {
    const sections = orderedSections();
    const document = props.document;
    if (!document || sections.length === 0) {
      setMountedSectionCount(0);
      return;
    }

    const anchorIndex = sectionIndexForAnchor(sections, props.initialAnchor);
    const initialCount =
      anchorIndex >= 0
        ? Math.min(sections.length, Math.max(INITIAL_SECTION_BATCH, anchorIndex + 1))
        : Math.min(INITIAL_SECTION_BATCH, sections.length);
    setMountedSectionCount(initialCount);

    if (initialCount >= sections.length) return;

    let cancelled = false;
    let count = initialCount;
    let idleHandle: number | undefined;

    const appendBatch = (): void => {
      if (cancelled) return;
      count = Math.min(
        sections.length,
        Math.max(count, mountedSectionCount()) + SECTION_BATCH_SIZE,
      );
      setMountedSectionCount(count);
      if (count < sections.length) {
        idleHandle = scheduleIdleWork(appendBatch);
      }
    };

    idleHandle = scheduleIdleWork(appendBatch);
    onCleanup(() => {
      cancelled = true;
      if (idleHandle !== undefined) cancelIdleWork(idleHandle);
    });
  });

  const findUnits = createMemo((): readonly DocumentFindUnit[] => {
    const document = props.document;
    if (!document) return [];
    const units: DocumentFindUnit[] = [];
    units.push({ id: document.id, text: displayDocumentTitle(document) });
    for (const section of orderedSections()) {
      units.push({ id: section.anchor, text: section.title });
      for (const item of resolveDocumentChunkItems(section.chunks)) {
        units.push({
          id: item.chunk.anchor,
          text:
            item.kind === 'rich'
              ? documentRenderBlockSearchText(item.block)
              : documentTextSearchText(
                  item.chunk.originalText,
                  item.chunk.metadata?.['sourceSpans'],
                ),
        });
      }
    }
    return units;
  });

  const findSearchable = createMemo(() => hasSearchableDocumentUnits(findUnits()));

  const rangesByUnit = createMemo(() => {
    const map = new Map<string, TextRange[]>();
    for (const match of findState().matches) {
      const existing = map.get(match.unitId) ?? [];
      existing.push({ start: match.start, end: match.end });
      map.set(match.unitId, existing);
    }
    return map;
  });

  const activeMatch = createMemo(() => {
    const state = findState();
    return state.matches[state.activeIndex];
  });
  let lastScrolledMatchKey = '';

  const chrome = useDocumentReaderChrome({
    ...(props.initialAnchor != null && props.initialAnchor !== ''
      ? { initialAnchor: props.initialAnchor }
      : {}),
    sectionSelector: '.document-overlay-section',
    outlineItemAttr: 'data-section-anchor',
    scrollSpyWhen: () => Boolean(props.document) && orderedSections().length > 0,
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

  createEffect(() => {
    const match = activeMatch();
    const state = findState();
    if (!match || state.loading) {
      if (state.loading) lastScrolledMatchKey = '';
      return;
    }
    const key = `${match.unitId}:${String(match.start)}:${String(state.activeIndex)}`;
    if (key === lastScrolledMatchKey) return;
    lastScrolledMatchKey = key;
    const sectionIndex = sectionIndexForAnchor(orderedSections(), match.unitId);
    if (sectionIndex >= mountedSectionCount()) {
      setMountedSectionCount(sectionIndex + 1);
      lastScrolledMatchKey = '';
      return;
    }
    const unitId = match.unitId;
    const start = match.start;
    requestAnimationFrame(() => {
      const paper = globalThis.document.querySelector<HTMLElement>('.document-overlay-paper');
      const mark = paper?.querySelector<HTMLElement>(
        `[data-document-find-unit="${CSS.escape(unitId)}"][data-document-find-start="${String(start)}"]`,
      );
      if (mark) {
        mark.scrollIntoView({ behavior: 'auto', block: 'center' });
        return;
      }
      globalThis.document.getElementById(unitId)?.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      });
    });
  });

  onMount(() => {
    requestAnimationFrame(() => {
      const anchor = props.initialAnchor;
      const target = anchor ? globalThis.document.getElementById(anchor) : null;
      const paper = globalThis.document.querySelector<HTMLElement>('.document-overlay-paper');
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
  const documentLinkMatcher = createMemo(() =>
    showDocumentLinks() ? createDocumentLinkMatcher(documentLinks()) : null,
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
      searchOpen={findOpen}
      trail={props.trail}
      onNavigate={props.onNavigate}
      breadcrumbs={
        <Show when={props.trail}>
          {(currentTrail) => (
            <DocumentCrumbs trail={currentTrail()} onNavigate={props.onNavigate} />
          )}
        </Show>
      }
      headerSearchSlot={
        <Show when={props.document}>
          <DocumentFindBar
            units={findUnits}
            disabled={!findSearchable()}
            onOpenChange={setFindOpen}
            onResult={(next) => {
              setFindState((current) => {
                if (
                  !next.query.trim() &&
                  !current.query.trim() &&
                  !next.loading &&
                  !current.loading &&
                  next.matches.length === 0 &&
                  current.matches.length === 0
                ) {
                  return current;
                }
                return next;
              });
            }}
          />
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
          <p class="document-overlay-outline-label">Оглавление</p>
        </Show>
      }
      outlineNav={
        <For each={orderedSections()}>
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
                <Show when={sourceTypeReaderLabel(documentValue().sourceType)}>
                  {(label) => <p class="document-overlay-paper__source-label">{label()}</p>}
                </Show>
                <h1 class="document-overlay-paper__title">
                  <QueryHighlightedText
                    text={displayDocumentTitle(documentValue())}
                    query={findState().query}
                    exact={findState().mode === 'exact'}
                    fuzzy={findState().mode === 'similar'}
                    ranges={rangesForFindUnit(
                      rangesByUnit(),
                      documentValue().id,
                      findState().query,
                    )}
                    unitId={documentValue().id}
                    activeStart={
                      activeMatch()?.unitId === documentValue().id
                        ? activeMatch()?.start
                        : undefined
                    }
                    matchClass="document-overlay-match"
                  />
                </h1>
                <header class="document-overlay-paper__header">
                  <Show when={displayDocumentSubtitle(documentValue())}>
                    {(subtitle) => <p class="document-overlay-lead">{subtitle()}</p>}
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
                  <div class="document-overlay-paper__actions">
                    <Show when={isClinicalSummary()}>
                      <Button
                        type="button"
                        class="document-overlay-full-text-inline"
                        variant="primary"
                        disabled={fullTextPending()}
                        aria-label={fullTextButtonLabel()}
                        onClick={() => void openFullText()}
                        icon={
                          <AppGlyph
                            name={fullTextPending() ? 'refresh' : 'download'}
                            class={`document-overlay-action-button__icon${fullTextPending() ? ' document-overlay-action-button__icon--spin' : ''}`}
                          />
                        }
                      >
                        {fullTextButtonLabel()}
                      </Button>
                    </Show>
                    <Button
                      type="button"
                      class="document-overlay-action-button"
                      aria-label="Распечатать документ"
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
                    <Show when={documentValue().sourceType === 'medical_reference'}>
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
                    </Show>
                  </div>
                </header>

                <For each={visibleSectionTree()}>
                  {(node) => {
                    const renderSection = (treeNode: typeof node): JSX.Element => {
                      const section = treeNode.section;
                      const path = () => section.sectionPath.join(' / ');
                      const state = () => findState();
                      const currentMatch = () => activeMatch();
                      const headingTag = documentSectionHeadingTag(section.depth);
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
                            component={headingTag}
                            class={`document-overlay-section__title document-overlay-section__title--${headingTag} document-overlay-section__title--copy`}
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
                            <QueryHighlightedText
                              text={section.title}
                              query={state().query}
                              exact={state().mode === 'exact'}
                              fuzzy={state().mode === 'similar'}
                              ranges={rangesForFindUnit(
                                rangesByUnit(),
                                section.anchor,
                                state().query,
                              )}
                              unitId={section.anchor}
                              activeStart={
                                currentMatch()?.unitId === section.anchor
                                  ? currentMatch()?.start
                                  : undefined
                              }
                              matchClass="document-overlay-match"
                            />
                          </Dynamic>
                          <For each={resolveDocumentChunkItems(section.chunks)}>
                            {(item) => {
                              const activeStart = () =>
                                currentMatch()?.unitId === item.chunk.anchor
                                  ? currentMatch()?.start
                                  : undefined;
                              return (
                                <Show
                                  when={item.kind === 'rich' ? item.block : undefined}
                                  fallback={
                                    <div
                                      id={item.chunk.anchor}
                                      class="document-text-chunk"
                                      classList={{
                                        'document-initial-anchor':
                                          props.initialAnchor === item.chunk.anchor,
                                      }}
                                    >
                                      <DocumentText
                                        text={item.chunk.originalText}
                                        query={state().query}
                                        exactQuery={state().mode === 'exact'}
                                        fuzzyQuery={state().mode === 'similar'}
                                        ranges={rangesForFindUnit(
                                          rangesByUnit(),
                                          item.chunk.anchor,
                                          state().query,
                                        )}
                                        unitId={item.chunk.anchor}
                                        activeStart={activeStart()}
                                        highlightClass="document-overlay-match"
                                        paragraphClass="document-overlay-section__paragraph"
                                        sourceSpans={item.chunk.metadata?.['sourceSpans']}
                                        documentLinkMatcher={documentLinkMatcher() ?? undefined}
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
                                      id={item.chunk.anchor}
                                      classList={{
                                        'document-rich-block': true,
                                        'document-initial-anchor':
                                          props.initialAnchor === item.chunk.anchor,
                                      }}
                                    >
                                      <DocumentRichBlock
                                        block={block()}
                                        highlight={{
                                          query: state().query,
                                          exact: state().mode === 'exact',
                                          fuzzy: state().mode === 'similar',
                                          ranges: rangesForFindUnit(
                                            rangesByUnit(),
                                            item.chunk.anchor,
                                            state().query,
                                          ),
                                          unitId: item.chunk.anchor,
                                          activeStart: activeStart(),
                                        }}
                                      />
                                    </div>
                                  )}
                                </Show>
                              );
                            }}
                          </For>
                          <For each={treeNode.children}>{(child) => renderSection(child)}</For>
                        </section>
                      );
                    };
                    return renderSection(node);
                  }}
                </For>
                <Show when={sectionsPending()}>
                  <p class="document-overlay-paper__pending" role="status" aria-live="polite">
                    Загружаем остальные разделы…
                  </p>
                </Show>
              </>
            )}
          </Show>
        </article>
      }
    />
  );
}
