import type { TextRange } from '@localmed/contracts';
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
import { OverlayDialog } from '@/components/OverlayDialog';
import { DocumentFindBar, type DocumentFindResultState } from '@/features/library/DocumentFindBar';
import {
  type DocumentFindUnit,
  hasSearchableDocumentUnits,
  rangesForFindUnit,
} from '@/features/library/document-find';
import { printElementHtml, printHtml } from '@/features/library/document-print';
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import {
  markUserDocumentPdf,
  markUserDocumentTextAvailable,
  useDocumentBookReadingMode,
} from '@/features/library/document-reading-mode';
import { LazyPdfCanvas } from '@/features/library/LazyPdfCanvas';
import { PinchZoomSurface } from '@/features/library/PinchZoomSurface';
import {
  isDocxMime,
  isPresentationMime,
  isRichDocumentMime,
  isSheetMime,
  RichDocumentRenderer,
} from '@/features/library/RichDocumentRenderer';
import { parseMarkdownDocument, SafeMarkdown } from '@/features/library/SafeMarkdown';
import { UserDocumentHighlights } from '@/features/library/UserDocumentHighlights';
import {
  buildUserDocumentOutlineItems,
  buildUserDocumentPrintHtml,
  escapePrintHtml,
  pageAnchorId,
  pageCanvasId,
} from '@/features/library/user-document-reader-helpers';
import { USER_LIBRARY_CATALOG_HASH } from '@/features/library/user-library-routing';
import type { DocumentTrail } from '@/state/document-trail';
import { loadPdfJsDocument, type PdfDocumentProxy } from '@/state/pdfjs-document';
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
    return 'Читаем файл… Страницы и текст появятся после первичного разбора.';
  }
  if (libraryDocument.status === 'ocr') {
    const done = libraryDocument.nativeTextPages + libraryDocument.ocrDonePages;
    return (
      'Распознаём текст: ' +
      done +
      ' из ' +
      libraryDocument.pageCount +
      ' страниц. Документ можно читать уже сейчас.'
    );
  }
  return '';
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
                left: `${String(word.x * 100)}%`,
                top: `${String(word.y * 100)}%`,
                width: `${String(word.w * 100)}%`,
                height: `${String(word.h * 100)}%`,
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
  const [pdfDocument, setPdfDocument] = createSignal<PdfDocumentProxy | null>(null);
  const [imageUrl, setImageUrl] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [findState, setFindState] = createSignal<DocumentFindResultState>(emptyFindState);
  const [findOpen, setFindOpen] = createSignal(false);
  const [markdownRaw, setMarkdownRaw] = createSignal(false);
  const [imageLightboxOpen, setImageLightboxOpen] = createSignal(false);
  let activePdf: PdfDocumentProxy | null = null;
  let pdfLoadGeneration = 0;

  const meta = (): UserLibraryDocument | null => libraryDocument();
  const isMarkdown = (): boolean => meta()?.mimeType === 'text/markdown';
  const markdownText = createMemo(() =>
    pages()
      .map((page) => page.text)
      .join('\n'),
  );
  const markdownAnchor = createMemo(() => {
    const firstPage = pages()[0];
    return firstPage ? pageAnchorId(props.documentId, firstPage.pageIndex) : undefined;
  });
  const parsedMarkdown = createMemo(() => parseMarkdownDocument(markdownText()));

  const outlineItems = createMemo(() => {
    const current = meta();
    if (!current) return [];
    if (isMarkdown()) return parsedMarkdown().outline;
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
      const pagesByIndex = new Map<number, UserLibraryPage>();
      for (const page of pages()) {
        if (!pagesByIndex.has(page.pageIndex)) pagesByIndex.set(page.pageIndex, page);
      }
      for (const pageIndex of pageIndexes) {
        const anchor = pageAnchorId(current.id, pageIndex);
        const page = pagesByIndex.get(pageIndex);
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
  createEffect(() => {
    markUserDocumentTextAvailable(findSearchable());
  });
  onCleanup(() => markUserDocumentTextAvailable(true));
  const readingMode = useDocumentBookReadingMode();
  const bookReadingMode = readingMode.bookMode;

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
          return;
        }
        globalThis.document.getElementById(match.unitId)?.scrollIntoView({
          behavior: 'auto',
          block: 'center',
        });
        return;
      }
      const word = globalThis.document.querySelector<HTMLElement>(
        '.user-document-reader__word--current',
      );
      word?.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
  });

  const replacePdf = async (blob: Blob): Promise<void> => {
    const generation = ++pdfLoadGeneration;
    const next = await loadPdfJsDocument(blob);
    if (generation !== pdfLoadGeneration) {
      await next.destroy();
      return;
    }
    const previous = activePdf;
    activePdf = next;
    setPdfDocument(next);
    setPdfPageCount(next.numPages);
    if (previous && previous !== next) await previous.destroy();
  };

  const refresh = async (reloadFile = false): Promise<void> => {
    const loadedMeta = await getUserLibraryDocument(props.documentId);
    setLibraryDocument(loadedMeta);
    if (!loadedMeta) {
      setLoadError('Личный документ больше недоступен.');
      return;
    }
    props.onTitle?.(loadedMeta.title);
    setPages(await listUserLibraryPages(props.documentId));

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
    if (!reloadFile && activePdf) return;

    const blob = await getUserLibraryFile(props.documentId);
    if (!blob) {
      setLoadError('Файл личного документа недоступен.');
      return;
    }
    await replacePdf(blob);
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
      pdfLoadGeneration += 1;
      window.removeEventListener(USER_LIBRARY_EVENT, handleChange);
      const url = imageUrl();
      if (url) URL.revokeObjectURL(url);
      const pdf = activePdf;
      activePdf = null;
      setPdfDocument(null);
      if (pdf) void pdf.destroy();
    });
  });

  createEffect(() => {
    const pageIndex = props.initialPageIndex;
    if (pageIndex === undefined) return;
    pages();
    markdownText();
    pdfPageCount();
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
    if (current.mimeType === 'text/markdown') {
      void printRenderedMarkdown(markdownText(), current.title).then((printed) => {
        if (!printed) toast.error('Не удалось открыть окно печати.');
      });
      return;
    }
    if (isSheetMime(current.mimeType)) {
      const rendered = document.querySelector<HTMLElement>('.rich-document-renderer.rich-sheet');
      if (!rendered) {
        toast.error('Документ ещё не готов к печати — попробуйте ещё раз через минуту.');
        return;
      }
      if (!printElementHtml(rendered, current.title))
        toast.error('Не удалось открыть окно печати.');
      return;
    }
    if (isPresentationMime(current.mimeType)) {
      const rendered = document.querySelector<HTMLElement>('.rich-document-renderer.rich-pptx');
      if (!rendered) {
        toast.error('Документ ещё не готов к печати — попробуйте ещё раз через минуту.');
        return;
      }
      if (!printElementHtml(rendered, current.title))
        toast.error('Не удалось открыть окно печати.');
      return;
    }
    if (isDocxMime(current.mimeType)) {
      const rendered = document.querySelector<HTMLElement>('.rich-document-renderer.rich-docx');
      if (!rendered) {
        toast.error('Документ ещё не готов к печати — попробуйте ещё раз через минуту.');
        return;
      }
      if (!printElementHtml(rendered, current.title))
        toast.error('Не удалось открыть окно печати.');
      return;
    }
    if (current.mimeType === 'application/pdf') {
      // Print the original PDF instead of our extracted text layer.
      void getUserLibraryFile(current.id).then((blob) => {
        if (!blob) {
          toast.error('Не удалось открыть окно печати.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.right = '0';
        frame.style.bottom = '0';
        frame.style.width = '1px';
        frame.style.height = '1px';
        frame.style.opacity = '0';
        frame.style.border = '0';
        frame.src = url;
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          window.setTimeout(() => {
            URL.revokeObjectURL(url);
            frame.remove();
          }, 60_000);
        };
        document.body.append(frame);
      });
      return;
    }
    if (isUserLibraryImageMime(current.mimeType)) {
      void getUserLibraryFile(current.id).then(async (blob) => {
        if (!blob) {
          toast.error('Не удалось открыть окно печати.');
          return;
        }
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve();
          probe.onerror = () => resolve();
          probe.src = url;
        });
        const printed = printHtml(
          `<!doctype html><html lang="ru"><head><meta charset="utf-8" /><title>${escapePrintHtml(current.title)}</title></head><body style="margin: 0"><img src="${url}" alt="${escapePrintHtml(current.title)}" style="max-width: 100%" /></body></html>`,
          current.title,
        );
        if (!printed) toast.error('Не удалось открыть окно печати.');
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      });
      return;
    }
    const html = buildUserDocumentPrintHtml(current.title, pages());
    if (!printHtml(html, current.title)) toast.error('Не удалось открыть окно печати.');
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
    if (!current || !isUserLibraryPdfMime(current.mimeType)) return [];
    return Array.from({ length: pdfPageCount() }, (_, index) => index);
  });

  const isPdf = (): boolean => {
    const current = meta();
    return current ? isUserLibraryPdfMime(current.mimeType) : false;
  };
  createEffect(() => {
    markUserDocumentPdf(isPdf());
  });
  onCleanup(() => markUserDocumentPdf(false));
  const isImage = (): boolean => {
    const current = meta();
    return current ? isUserLibraryImageMime(current.mimeType) : false;
  };
  const richMime = (): string | undefined => {
    const current = meta();
    return current && isRichDocumentMime(current.mimeType) ? current.mimeType : undefined;
  };
  const isTextLike = (): boolean => {
    const current = meta();
    return current ? isUserLibraryTextLikeMime(current.mimeType) && !richMime() : false;
  };
  const showBannerProgress = (): boolean => {
    const current = meta();
    return current?.status === 'inspecting' || current?.status === 'ocr';
  };

  const pageByIndex = (pageIndex: number): UserLibraryPage | undefined =>
    pages().find((item) => item.pageIndex === pageIndex);

  return (
    <>
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
                      <Show when={isMarkdown()}>
                        <Button
                          type="button"
                          class="document-overlay-action-button"
                          onClick={() => setMarkdownRaw((raw) => !raw)}
                          icon={
                            <AppGlyph
                              name="file-text"
                              class="document-overlay-action-button__icon"
                            />
                          }
                        >
                          {markdownRaw() ? 'Preview' : 'Raw'}
                        </Button>
                      </Show>
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
              <div
                class="user-document-reader__pages"
                classList={{ 'user-document-reader__pages--two': readingMode.twoPageMode() }}
              >
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
                          <LazyPdfCanvas
                            id={pageCanvasId(props.documentId, pageIndex)}
                            pageNumber={pageIndex + 1}
                            pdf={pdfDocument}
                            class="user-document-reader__canvas"
                            onError={(cause) => {
                              setLoadError(
                                cause instanceof Error
                                  ? cause.message
                                  : 'Не удалось отобразить страницу PDF.',
                              );
                            }}
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
                      <button
                        type="button"
                        class="user-document-reader__image-open"
                        aria-label="Открыть изображение крупно"
                        onClick={() => setImageLightboxOpen(true)}
                      >
                        <img
                          src={url()}
                          class="user-document-reader__image"
                          alt={meta()?.title ?? 'Изображение'}
                        />
                      </button>
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

            <Show when={meta() && !isPdf() && !isImage() && !richMime() && !isTextLike()}>
              <Show when={meta()} keyed>
                {(current) => (
                  <section class="user-document-reader__binary" aria-label={current.title}>
                    <AppGlyph name="archive" class="user-document-reader__binary-icon" />
                    <p class="user-document-reader__binary-name">{current.fileName}</p>
                    <p class="user-document-reader__binary-hint">
                      Этот тип файла нельзя открыть во встроенной читалке.
                    </p>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => {
                        void getUserLibraryFile(current.id).then((blob) => {
                          if (!blob) return;
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = current.fileName || current.title;
                          document.body.append(link);
                          link.click();
                          link.remove();
                          window.setTimeout(() => URL.revokeObjectURL(url), 4000);
                        });
                      }}
                    >
                      Сохранить на устройство
                    </Button>
                  </section>
                )}
              </Show>
            </Show>

            <Show when={richMime()}>
              {(mime) => (
                <Show when={meta()} keyed>
                  {(current) => <RichDocumentRenderer documentId={current.id} mimeType={mime()} />}
                </Show>
              )}
            </Show>

            <Show when={isTextLike() && meta()}>
              {(current) => (
                <UserDocumentHighlights
                  documentId={current().id}
                  surface={() =>
                    document.querySelector<HTMLElement>('.user-document-reader__paper') ?? undefined
                  }
                />
              )}
            </Show>

            <Show when={isTextLike()}>
              <Show
                when={isMarkdown() && !markdownRaw()}
                fallback={
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
                }
              >
                <div class="user-document-reader__text-section" id={markdownAnchor()}>
                  <SafeMarkdown markdown={markdownText()} />
                </div>
              </Show>
            </Show>
          </article>
        }
      />
      <OverlayDialog
        open={imageLightboxOpen()}
        title={meta()?.title ?? 'Изображение'}
        class="user-doc-image-lightbox"
        onClose={() => setImageLightboxOpen(false)}
      >
        <Show when={imageUrl()}>
          {(url) => (
            <img
              src={url()}
              class="user-doc-image-lightbox__image"
              alt={meta()?.title ?? 'Изображение'}
            />
          )}
        </Show>
      </OverlayDialog>
    </>
  );
}

const markdownPrintStyles = `
  body { font: 11pt/1.55 Georgia, 'Times New Roman', serif; color: #2b2b26; }
  h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 0.4em; line-height: 1.2; break-after: avoid; }
  p { margin: 0.45em 0; }
  ul, ol { margin: 0.45em 0; padding-left: 1.6em; }
  blockquote { margin: 0.7em 0; padding: 0.3em 0.9em; border-left: 3px solid #cbc0a7; color: #585349; }
  code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.88em; background: #f3efe2; padding: 0.1em 0.3em; border-radius: 3px; }
  pre { padding: 0.6em 0.8em; background: #f3efe2; border-radius: 4px; overflow: auto; }
  table { border-collapse: collapse; } th, td { border: 0.6pt solid #cbc0a7; padding: 3mm 2mm; }
  img { max-width: 100%; }
  figure { margin: 2mm 0 3mm; break-inside: avoid; }
  figcaption { font-size: 8pt; color: #585349; margin-top: 1mm; }
  hr { border: 0; border-top: 0.6pt solid #cbc0a7; margin: 4mm 0; }
`;

async function printRenderedMarkdown(markdown: string, title: string): Promise<boolean> {
  const [{ render }, { createComponent }] = await Promise.all([
    import('solid-js/web'),
    import('solid-js'),
  ]);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '-100vw';
  document.body.append(host);
  const dispose = render(() => createComponent(SafeMarkdown, { markdown }), host);
  const html = host.innerHTML;
  dispose();
  host.remove();
  if (!html.trim()) return false;
  return printHtml(
    `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapePrintHtml(title)}</title>
<style>@page { size: A4; margin: 14mm; }${markdownPrintStyles}</style>
</head>
<body>${html}</body>
</html>`,
    title,
  );
}
