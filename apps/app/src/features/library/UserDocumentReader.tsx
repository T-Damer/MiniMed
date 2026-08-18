import type { TextRange } from '@localmed/contracts';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
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
import { toast } from 'solid-sonner';
import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DocumentCrumbs } from '@/components/DocumentCrumbs';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { DocumentFindBar, type DocumentFindResultState } from '@/features/library/DocumentFindBar';
import {
  type DocumentFindUnit,
  hasSearchableDocumentUnits,
  rangesForFindUnit,
} from '@/features/library/document-find';
import { printHtml } from '@/features/library/document-print';
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import { useBookReadingModeActive } from '@/features/library/document-reading-mode';
import { PinchZoomSurface } from '@/features/library/PinchZoomSurface';
import {
  buildUserDocumentOutlineItems,
  buildUserDocumentPrintHtml,
  pageAnchorId,
  pageCanvasId,
} from '@/features/library/user-document-reader-helpers';
import { USER_LIBRARY_CATALOG_HASH } from '@/features/library/user-library-routing';
import type { DocumentTrail } from '@/state/document-trail';
import {
  getUserLibraryDocument,
  getUserLibraryFile,
  isUserLibraryImageMime,
  isUserLibraryPdfMime,
  isUserLibraryTextLikeMime,
  listUserLibraryPages,
  USER_LIBRARY_EVENT,
  type UserLibraryDocument,
  type UserLibraryPage,
  type UserLibraryWordBox,
  userLibraryProgressFraction,
} from '@/state/user-library';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface UserDocumentReaderProps {
  readonly documentId: string;
  readonly initialPageIndex?: number;
  readonly trail?: DocumentTrail | null;
  readonly onNavigate?: (href: string) => void;
  readonly onTitle?: (title: string) => void;
}

const emptyFindState: DocumentFindResultState = {
  query: '',
  mode: 'exact',
  matches: [],
  activeIndex: 0,
  loading: false,
};

function statusBanner(libraryDocument: UserLibraryDocument): string {
  if (libraryDocument.status === 'inspecting') {
    return 'Читаем файл… Текст появится в поиске после обработки.';
  }
  if (libraryDocument.status === 'ocr') {
    const done = libraryDocument.nativeTextPages + libraryDocument.ocrDonePages;
    return (
      'Распознаём текст: ' +
      done +
      ' из ' +
      libraryDocument.pageCount +
      ' страниц. Книгу можно читать уже сейчас.'
    );
  }
  return '';
}

async function renderPdfCanvases(documentId: string, pageCount: number, blob: Blob): Promise<void> {
  const data = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const domDocument = globalThis.document;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.25 });
    const canvas = domDocument.getElementById(
      pageCanvasId(documentId, pageNumber - 1),
    ) as HTMLCanvasElement | null;
    if (!canvas) continue;
    const context = canvas.getContext('2d');
    if (!context) continue;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
  }
}

function navigateHref(props: UserDocumentReaderProps, href: string): void {
  if (props.onNavigate) {
    props.onNavigate(href);
    return;
  }
  window.location.hash = href;
}

function wordUnitId(pageAnchor: string, wordIndex: number): string {
  return `${pageAnchor}:${wordIndex}`;
}

function WordOverlay(props: {
  readonly pageAnchor: string;
  readonly words: readonly UserLibraryWordBox[];
  readonly hitUnitIds: () => ReadonlySet<string>;
  readonly activeUnitId: () => string | undefined;
}): JSX.Element {
  return (
    <div class="user-document-reader__word-layer">
      <For each={props.words}>
        {(word, index) => {
          const unitId = () => wordUnitId(props.pageAnchor, index());
          return (
            <span
              class="user-document-reader__word"
              classList={{
                'user-document-reader__word--hit': props.hitUnitIds().has(unitId()),
                'user-document-reader__word--current': props.activeUnitId() === unitId(),
              }}
              style={{
                left: String(word.x * 100) + '%',
                top: String(word.y * 100) + '%',
                width: String(word.w * 100) + '%',
                height: String(word.h * 100) + '%',
              }}
            >
              {word.text}
            </span>
          );
        }}
      </For>
    </div>
  );
}

export function UserDocumentReader(props: UserDocumentReaderProps): JSX.Element {
  const [libraryDocument, setLibraryDocument] = createSignal<UserLibraryDocument | null>(null);
  const [pages, setPages] = createSignal<readonly UserLibraryPage[]>([]);
  const [pdfPageCount, setPdfPageCount] = createSignal(0);
  const [pdfBlob, setPdfBlob] = createSignal<Blob | null>(null);
  const [imageUrl, setImageUrl] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [findState, setFindState] = createSignal<DocumentFindResultState>(emptyFindState);
  const [findOpen, setFindOpen] = createSignal(false);

  const meta = (): UserLibraryDocument | null => libraryDocument();

  const outlineItems = createMemo(() => {
    const current = meta();
    if (!current) return [];
    return buildUserDocumentOutlineItems(
      current.mimeType,
      pages(),
      isUserLibraryPdfMime(current.mimeType)
        ? { documentId: current.id, visualPageCount: pdfPageCount() }
        : { documentId: current.id },
    );
  });

  const findUnits = createMemo((): readonly DocumentFindUnit[] => {
    const current = meta();
    if (!current) return [];
    const titleUnit: DocumentFindUnit = { id: current.id, text: current.title };
    if (isUserLibraryTextLikeMime(current.mimeType)) {
      return [
        titleUnit,
        ...pages().map((page) => ({
          id: pageAnchorId(page.documentId, page.pageIndex),
          text: page.text,
        })),
      ];
    }
    if (isUserLibraryPdfMime(current.mimeType) || isUserLibraryImageMime(current.mimeType)) {
      const units: DocumentFindUnit[] = [titleUnit];
      const pageIndexes =
        isUserLibraryPdfMime(current.mimeType) && pdfPageCount() > 0
          ? Array.from({ length: pdfPageCount() }, (_, index) => index)
          : [0];
      for (const pageIndex of pageIndexes) {
        const anchor = pageAnchorId(current.id, pageIndex);
        const page = pages().find((item) => item.pageIndex === pageIndex);
        const words = page?.words ?? [];
        words.forEach((word, wordIndex) => {
          units.push({ id: wordUnitId(anchor, wordIndex), text: word.text });
        });
      }
      return units;
    }
    return [titleUnit];
  });

  const findSearchable = createMemo(() => hasSearchableDocumentUnits(findUnits()));
  const bookReadingMode = useBookReadingModeActive();

  const chrome = useDocumentReaderChrome({
    sectionSelector: '[data-user-doc-anchor]',
    outlineItemAttr: 'data-outline-anchor',
    scrollSpyWhen: () => Boolean(meta()) && outlineItems().length > 0,
  });

  const rangesByUnit = createMemo(() => {
    const map = new Map<string, TextRange[]>();
    for (const match of findState().matches) {
      const existing = map.get(match.unitId) ?? [];
      existing.push({ start: match.start, end: match.end });
      map.set(match.unitId, existing);
    }
    return map;
  });

  const hitUnitIds = createMemo(() => new Set(findState().matches.map((match) => match.unitId)));

  const activeMatch = createMemo(() => {
    const matches = findState().matches;
    const state = findState();
    return matches[state.activeIndex];
  });
  let lastScrolledMatchKey = '';

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
    requestAnimationFrame(() => {
      const current = meta();
      if (!current) return;
      if (isUserLibraryTextLikeMime(current.mimeType)) {
        const paper = globalThis.document.querySelector<HTMLElement>(
          '.user-document-reader__paper',
        );
        const mark = paper?.querySelector<HTMLElement>(
          `[data-document-find-unit="${CSS.escape(match.unitId)}"][data-document-find-start="${String(match.start)}"]`,
        );
        if (mark) {
          mark.scrollIntoView({ behavior: 'auto', block: 'center' });
        } else {
          globalThis.document.getElementById(match.unitId)?.scrollIntoView({
            behavior: 'auto',
            block: 'center',
          });
        }
        return;
      }
      const word = globalThis.document.querySelector<HTMLElement>(
        '.user-document-reader__word--current',
      );
      word?.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
  });

  const refresh = async (reloadFile = false): Promise<void> => {
    const loadedMeta = await getUserLibraryDocument(props.documentId);
    setLibraryDocument(loadedMeta);
    if (!loadedMeta) {
      setLoadError('Личный документ больше недоступен.');
      return;
    }
    props.onTitle?.(loadedMeta.title);
    const loadedPages = await listUserLibraryPages(props.documentId);
    setPages(loadedPages);

    if (isUserLibraryImageMime(loadedMeta.mimeType)) {
      if (!reloadFile && imageUrl()) return;
      const blob = await getUserLibraryFile(props.documentId);
      if (!blob) {
        setLoadError('Файл личного документа недоступен.');
        return;
      }
      const previousUrl = imageUrl();
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      setImageUrl(URL.createObjectURL(blob));
      return;
    }

    if (!isUserLibraryPdfMime(loadedMeta.mimeType)) return;
    if (!reloadFile && pdfBlob() && pdfPageCount() > 0) return;

    const blob = await getUserLibraryFile(props.documentId);
    if (!blob) {
      setLoadError('Файл личного документа недоступен.');
      return;
    }
    const data = await blob.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data }).promise;
    setPdfPageCount(pdf.numPages);
    setPdfBlob(blob);
  };

  onMount(() => {
    void refresh(true).catch((cause) => {
      setLoadError(cause instanceof Error ? cause.message : 'Не удалось открыть документ.');
    });
    const handleChange = (): void => {
      void refresh().catch((cause) => {
        setLoadError(cause instanceof Error ? cause.message : 'Не удалось обновить документ.');
      });
    };
    window.addEventListener(USER_LIBRARY_EVENT, handleChange);
    onCleanup(() => {
      window.removeEventListener(USER_LIBRARY_EVENT, handleChange);
      const url = imageUrl();
      if (url) URL.revokeObjectURL(url);
    });
  });

  createEffect(() => {
    const documentId = props.documentId;
    const count = pdfPageCount();
    const blob = pdfBlob();
    if (count === 0 || !blob) return;
    void renderPdfCanvases(documentId, count, blob).catch((cause) => {
      setLoadError(cause instanceof Error ? cause.message : 'Не удалось отобразить PDF.');
    });
  });

  createEffect(() => {
    const pageIndex = props.initialPageIndex;
    if (pageIndex === undefined) return;
    requestAnimationFrame(() => {
      const element = globalThis.document.getElementById(pageAnchorId(props.documentId, pageIndex));
      element?.scrollIntoView({ block: 'start' });
    });
  });

  const banner = (): string => {
    const current = meta();
    return current ? statusBanner(current) : '';
  };

  const printDocument = (): void => {
    const current = meta();
    if (!current) return;
    const html = buildUserDocumentPrintHtml(current.title, pages());
    if (!printHtml(html, current.title)) {
      toast.error('Не удалось открыть окно печати.');
    }
  };

  const breadcrumbItems = createMemo(() => {
    const current = meta();
    return [
      { label: 'Документы', href: '#/modules/documents' },
      { label: 'Ваши документы', href: USER_LIBRARY_CATALOG_HASH },
      { label: current?.title ?? 'Личный документ' },
    ];
  });

  const visualPageIndexes = createMemo(() => {
    const current = meta();
    if (!current || !isUserLibraryPdfMime(current.mimeType)) {
      return [];
    }
    return Array.from({ length: pdfPageCount() }, (_, index) => index);
  });

  const isPdf = (): boolean => {
    const current = meta();
    return current ? isUserLibraryPdfMime(current.mimeType) : false;
  };
  const isImage = (): boolean => {
    const current = meta();
    return current ? isUserLibraryImageMime(current.mimeType) : false;
  };
  const isTextLike = (): boolean => {
    const current = meta();
    return current ? isUserLibraryTextLikeMime(current.mimeType) : false;
  };
  const showBannerProgress = (): boolean => {
    const current = meta();
    return current?.status === 'inspecting' || current?.status === 'ocr';
  };

  const pageByIndex = (pageIndex: number): UserLibraryPage | undefined =>
    pages().find((item) => item.pageIndex === pageIndex);

  return (
    <DocumentReaderChromeShell
      ariaLabel={meta()?.title ?? 'Личный документ'}
      class="document-page user-document-reader page-surface page-grain"
      classList={{ 'document-page--book': bookReadingMode() }}
      chromeClass="document-page__chrome sticky-surface route-sticky-chrome"
      chrome={chrome}
      searchOpen={findOpen}
      trail={props.trail ?? null}
      onNavigate={(href) => navigateHref(props, href)}
      breadcrumbs={
        <Show
          when={props.trail}
          fallback={
            <AppBreadcrumbs
              items={breadcrumbItems()}
              onNavigate={(href) => navigateHref(props, href)}
            />
          }
        >
          {(currentTrail) => (
            <DocumentCrumbs
              trail={currentTrail()}
              onNavigate={(href) => navigateHref(props, href)}
            />
          )}
        </Show>
      }
      headerSearchSlot={
        <DocumentFindBar
          class="document-page__header-search"
          units={findUnits}
          disabled={!findSearchable()}
          onOpenChange={setFindOpen}
          onResult={setFindState}
        />
      }
      bodyError={
        <Show when={loadError()}>
          {(message) => <p class="user-document-reader__error">{message()}</p>}
        </Show>
      }
      showLayout
      bodyPrefix={
        <Show when={banner()}>
          {(message) => (
            <div class="user-document-reader__banner" role="status">
              <p class="user-document-reader__banner-text">{message()}</p>
              <Show when={showBannerProgress()}>
                <Show when={meta()}>
                  {(current) => (
                    <progress
                      class="user-document-reader__banner-progress"
                      max={1}
                      value={userLibraryProgressFraction(current())}
                    />
                  )}
                </Show>
              </Show>
            </div>
          )}
        </Show>
      }
      outlineNav={
        <Show
          when={outlineItems().length > 0}
          fallback={
            <p class="document-overlay-outline-empty">
              {meta()?.status === 'inspecting'
                ? 'Документ обрабатывается — оглавление появится после извлечения текста.'
                : 'Нет разделов для отображения.'}
            </p>
          }
        >
          <For each={outlineItems()}>
            {(item) => (
              <button
                type="button"
                data-outline-anchor={item.anchor}
                class="document-overlay-outline-item"
                classList={{
                  'document-overlay-outline-item--depth-2': item.depth === 2,
                  'document-overlay-outline-item--depth-3': item.depth >= 3,
                  'document-overlay-outline-item--active': chrome.activeAnchor() === item.anchor,
                }}
                aria-current={chrome.activeAnchor() === item.anchor ? 'location' : undefined}
                onClick={() => chrome.scrollTo(item.anchor)}
              >
                {item.label}
              </button>
            )}
          </For>
        </Show>
      }
      content={
        <article ref={chrome.setPaper} class="document-overlay-paper user-document-reader__paper">
          <Show when={meta()}>
            {(current) => (
              <>
                <h1 class="document-overlay-paper__title">
                  <QueryHighlightedText
                    text={current().title}
                    query={findState().query}
                    exact={findState().mode === 'exact'}
                    fuzzy={findState().mode === 'similar'}
                    ranges={rangesForFindUnit(rangesByUnit(), current().id, findState().query)}
                    unitId={current().id}
                    activeStart={
                      activeMatch()?.unitId === current().id ? activeMatch()?.start : undefined
                    }
                    matchClass="document-overlay-match"
                  />
                </h1>
                <header class="document-overlay-paper__header">
                  <div class="document-overlay-paper__actions">
                    <Button
                      type="button"
                      class="document-overlay-action-button"
                      aria-label="Распечатать документ"
                      onClick={printDocument}
                      icon={
                        <AppGlyph name="printer" class="document-overlay-action-button__icon" />
                      }
                    >
                      Распечатать
                    </Button>
                  </div>
                </header>
              </>
            )}
          </Show>
          <Show when={isPdf()}>
            <div class="user-document-reader__pages">
              <For each={visualPageIndexes()}>
                {(pageIndex) => {
                  const page = (): UserLibraryPage | undefined => pageByIndex(pageIndex);
                  const words = (): readonly UserLibraryWordBox[] => page()?.words ?? [];
                  const anchor = () => pageAnchorId(props.documentId, pageIndex);
                  return (
                    <section
                      id={anchor()}
                      data-user-doc-anchor=""
                      class="user-document-reader__page"
                    >
                      <PinchZoomSurface
                        class="user-document-reader__page-pinch"
                        contentClass="user-document-reader__page-surface"
                      >
                        <canvas
                          id={pageCanvasId(props.documentId, pageIndex)}
                          class="user-document-reader__canvas"
                        />
                        <Show when={words().length > 0}>
                          <WordOverlay
                            pageAnchor={anchor()}
                            words={words()}
                            hitUnitIds={hitUnitIds}
                            activeUnitId={() => activeMatch()?.unitId}
                          />
                        </Show>
                      </PinchZoomSurface>
                    </section>
                  );
                }}
              </For>
            </div>
          </Show>

          <Show when={isImage()}>
            <section
              id={pageAnchorId(props.documentId, 0)}
              data-user-doc-anchor=""
              class="user-document-reader__page"
            >
              <PinchZoomSurface
                class="user-document-reader__page-pinch"
                contentClass="user-document-reader__page-surface"
              >
                <Show when={imageUrl()}>
                  {(url) => (
                    <img
                      src={url()}
                      class="user-document-reader__image"
                      alt={meta()?.title ?? 'Изображение'}
                    />
                  )}
                </Show>
                <Show when={pageByIndex(0)?.words}>
                  {(wordBoxes) => (
                    <WordOverlay
                      pageAnchor={pageAnchorId(props.documentId, 0)}
                      words={wordBoxes()}
                      hitUnitIds={hitUnitIds}
                      activeUnitId={() => activeMatch()?.unitId}
                    />
                  )}
                </Show>
              </PinchZoomSurface>
            </section>
          </Show>

          <Show when={isTextLike()}>
            <div class="user-document-reader__text-pages">
              <For each={pages()}>
                {(page) => {
                  const anchor = () => pageAnchorId(page.documentId, page.pageIndex);
                  const state = () => findState();
                  const activeStart = () =>
                    activeMatch()?.unitId === anchor() ? activeMatch()?.start : undefined;
                  return (
                    <section
                      id={anchor()}
                      data-user-doc-anchor=""
                      class="user-document-reader__text-section"
                    >
                      <pre class="user-document-reader__text">
                        <QueryHighlightedText
                          text={page.text}
                          query={state().query}
                          exact={state().mode === 'exact'}
                          fuzzy={state().mode === 'similar'}
                          ranges={rangesForFindUnit(rangesByUnit(), anchor(), state().query)}
                          unitId={anchor()}
                          activeStart={activeStart()}
                          matchClass="document-overlay-match"
                        />
                      </pre>
                    </section>
                  );
                }}
              </For>
            </div>
          </Show>
        </article>
      }
    />
  );
}
