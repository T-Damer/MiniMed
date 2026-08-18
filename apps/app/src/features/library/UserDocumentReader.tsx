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
import { SearchField } from '@/components/SearchField';
import { printHtml } from '@/features/library/document-print';
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import {
  buildUserDocumentOutlineItems,
  buildUserDocumentPrintHtml,
  filterOutlineItems,
  pageAnchorId,
  pageCanvasId,
  textMatchesDocumentQuery,
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

function WordOverlay(props: {
  readonly words: readonly UserLibraryWordBox[];
  readonly query: () => string;
}): JSX.Element {
  return (
    <div class="user-document-reader__word-layer">
      <For each={props.words}>
        {(word) => (
          <span
            class="user-document-reader__word"
            classList={{
              'user-document-reader__word--hit': textMatchesDocumentQuery(word.text, props.query()),
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
        )}
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
  const [query, setQuery] = createSignal('');

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

  const matchingOutlineItems = createMemo(() => filterOutlineItems(outlineItems(), query()));

  const chrome = useDocumentReaderChrome({
    sectionSelector: '[data-user-doc-anchor]',
    outlineItemAttr: 'data-outline-anchor',
    scrollSpyWhen: () => Boolean(meta()) && matchingOutlineItems().length > 0,
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

  createEffect(() => {
    const trimmed = query().trim();
    if (!trimmed) return;
    const first = matchingOutlineItems()[0];
    if (!first) return;
    const currentAnchor = first.anchor;
    requestAnimationFrame(() => {
      if (query().trim() !== trimmed) return;
      chrome.scrollTo(currentAnchor);
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

  const textPageClass = (text: string): string => {
    const base = 'user-document-reader__text';
    if (!query().trim()) return base;
    return textMatchesDocumentQuery(text, query())
      ? base + ' user-document-reader__text--hit'
      : base;
  };

  return (
    <DocumentReaderChromeShell
      ariaLabel={meta()?.title ?? 'Личный документ'}
      class="document-page user-document-reader page-surface page-grain"
      chromeClass="document-page__chrome sticky-surface route-sticky-chrome"
      chrome={chrome}
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
        <SearchField
          class="document-page__header-search"
          label="Поиск в документе"
          value={query()}
          onInput={setQuery}
          placeholder="Слово или фраза"
          hideLabel
        />
      }
      printButton={
        <Button
          type="button"
          variant="icon"
          class="document-page__print overlay-dialog__print-button"
          aria-label="Печать документа"
          title="Печать документа"
          onClick={printDocument}
          icon={<AppGlyph name="printer" class="overlay-dialog__button-icon" />}
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
          when={matchingOutlineItems().length > 0}
          fallback={
            <p class="document-overlay-outline-empty">
              {meta()?.status === 'inspecting'
                ? 'Документ обрабатывается — оглавление появится после извлечения текста.'
                : 'Нет разделов для отображения.'}
            </p>
          }
        >
          <For each={matchingOutlineItems()}>
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
          <Show when={isPdf()}>
            <div class="user-document-reader__pages">
              <For each={visualPageIndexes()}>
                {(pageIndex) => {
                  const page = (): UserLibraryPage | undefined => pageByIndex(pageIndex);
                  const words = (): readonly UserLibraryWordBox[] => page()?.words ?? [];
                  return (
                    <section
                      id={pageAnchorId(props.documentId, pageIndex)}
                      data-user-doc-anchor=""
                      class="user-document-reader__page"
                    >
                      <div class="user-document-reader__page-surface">
                        <canvas
                          id={pageCanvasId(props.documentId, pageIndex)}
                          class="user-document-reader__canvas"
                        />
                        <Show when={words().length > 0}>
                          <WordOverlay words={words()} query={query} />
                        </Show>
                      </div>
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
              <div class="user-document-reader__page-surface">
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
                  {(wordBoxes) => <WordOverlay words={wordBoxes()} query={query} />}
                </Show>
              </div>
            </section>
          </Show>

          <Show when={isTextLike()}>
            <div class="user-document-reader__text-pages">
              <For each={pages()}>
                {(page) => (
                  <section
                    id={pageAnchorId(page.documentId, page.pageIndex)}
                    data-user-doc-anchor=""
                    class="user-document-reader__text-section"
                  >
                    <pre class={textPageClass(page.text)}>{page.text}</pre>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </article>
      }
    />
  );
}
