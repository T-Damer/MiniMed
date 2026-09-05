import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import { SpreadsheetRenderer } from '@/features/library/SpreadsheetRenderer';
import { UserHighlightPopup } from '@/features/library/UserHighlightPopup';
import {
  findEpubOutlineAnchor,
  flattenEpubNavigation,
  pageAnchorId,
  type UserDocumentOutlineItem,
} from '@/features/library/user-document-reader-helpers';
import { getUserLibraryFile, userLibraryFileCapability } from '@/state/user-library';
import {
  addUserHighlight,
  loadUserHighlights,
  removeUserHighlight,
  type UserDocumentHighlight,
  type UserHighlightColor,
  userHighlightColor,
} from '@/state/user-library-highlights';

interface EpubContents {
  readonly document: Document;
  readonly window: Window;
}

interface EpubLocation {
  readonly start?: { readonly href?: string };
}

interface EpubHighlightPopup {
  readonly x: number;
  readonly y: number;
  readonly remove: boolean;
  readonly action: (color?: UserHighlightColor) => Promise<void>;
}

function popupPoint(contents: EpubContents, rect: DOMRect): { x: number; y: number } {
  const frame = contents.window.frameElement;
  const frameRect = frame instanceof HTMLElement ? frame.getBoundingClientRect() : new DOMRect();
  return {
    x: frameRect.left + rect.left + rect.width / 2,
    y: frameRect.top + rect.top,
  };
}

function isEpubMime(mimeType: string): boolean {
  return userLibraryFileCapability(mimeType).reader.renderer === 'epub';
}

export function isSheetMime(mimeType: string): boolean {
  return userLibraryFileCapability(mimeType).reader.renderer === 'sheet';
}

export function isPresentationMime(mimeType: string): boolean {
  return userLibraryFileCapability(mimeType).reader.renderer === 'presentation';
}

export function isDocxMime(mimeType: string): boolean {
  return userLibraryFileCapability(mimeType).reader.renderer === 'docx';
}

export function isRichDocumentMime(mimeType: string): boolean {
  const renderer = userLibraryFileCapability(mimeType).reader.renderer;
  return (
    renderer === 'epub' ||
    renderer === 'docx' ||
    renderer === 'sheet' ||
    renderer === 'presentation'
  );
}

/**
 * Renders original EPUB (epub.js), Office Open XML, and spreadsheet files instead
 * of the extracted plain-text fallback. Text extraction still powers search.
 */
export function RichDocumentRenderer(props: {
  readonly documentId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fullscreen?: boolean;
  readonly activeSheetName?: string;
  readonly onSheetNamesChange?: (sheetNames: readonly string[]) => void;
  readonly onActiveSheetChange?: (sheetName: string) => void;
  readonly onExitFullscreen?: () => void;
  readonly onPresentationSlideClick?: (slide: HTMLElement) => void;
  readonly onEpubOutlineChange?: (items: readonly UserDocumentOutlineItem[]) => void;
  readonly onEpubNavigateReady?: (navigate: ((href: string) => void) | null) => void;
  readonly onEpubActiveOutlineChange?: (anchor: string) => void;
}): JSX.Element {
  if (isSheetMime(props.mimeType)) {
    return (
      <SpreadsheetRenderer
        documentId={props.documentId}
        fileName={props.fileName}
        mimeType={props.mimeType}
        fullscreen={props.fullscreen}
        activeSheetName={props.activeSheetName}
        onSheetNamesChange={props.onSheetNamesChange}
        onActiveSheetChange={props.onActiveSheetChange}
        onExitFullscreen={props.onExitFullscreen}
      />
    );
  }

  let host!: HTMLDivElement;
  const [epubHighlightPopup, setEpubHighlightPopup] = createSignal<EpubHighlightPopup | null>(null);

  onMount(() => {
    let disposed = false;
    let destroyBook: (() => void) | undefined;
    const dismissHighlightPopup = (event: Event): void => {
      if (
        event.target !== document &&
        event.target !== window &&
        event.target instanceof Node &&
        !host.contains(event.target)
      )
        return;
      setEpubHighlightPopup(null);
    };
    window.addEventListener('scroll', dismissHighlightPopup, { capture: true, passive: true });
    void getUserLibraryFile(props.documentId)
      .then(async (blob) => {
        if (!blob || disposed) return;
        const buffer = await blob.arrayBuffer();
        if (disposed) return;
        try {
          if (isEpubMime(props.mimeType)) {
            const ePub = (await import('epubjs')).default;
            if (disposed) return;
            const book = ePub(buffer as ArrayBuffer);
            host.classList.add('rich-document-renderer--epub');
            document.documentElement.classList.add('epub-page-scroll');
            const renditionOptions = {
              width: '100%',
              manager: 'continuous',
              flow: 'scrolled',
              fullsize: true,
            };
            const rendition = book.renderTo(host, renditionOptions);
            destroyBook = () => {
              void rendition.destroy();
              void book.destroy();
            };
            const annotate = (highlight: UserDocumentHighlight): void => {
              const cfiRange = highlight.cfiRange;
              if (!cfiRange) return;
              rendition.annotations.highlight(
                cfiRange,
                {},
                (event: Event) => {
                  // marks-pane clones pointer events without their coordinates; use the mark.
                  if (!(event.currentTarget instanceof Element)) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setEpubHighlightPopup({
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                    remove: true,
                    action: async () => {
                      const saved = await loadUserHighlights(props.documentId);
                      for (const item of saved) {
                        if (item.cfiRange === cfiRange) await removeUserHighlight(item.id);
                      }
                      rendition.annotations.remove(cfiRange, 'highlight');
                      setEpubHighlightPopup(null);
                    },
                  });
                },
                'epub-user-highlight',
                {
                  fill: userHighlightColor(highlight.color).fill,
                  'fill-opacity': '0.55',
                  'mix-blend-mode': 'multiply',
                },
              );
            };
            const preventSelectedContextMenu = (contents: EpubContents): void => {
              contents.document.addEventListener('contextmenu', (event) => {
                if (!contents.window.getSelection()?.isCollapsed) event.preventDefault();
              });
            };
            rendition.hooks.content.register(preventSelectedContextMenu);
            const handleSelected = (cfiRange: string, contents: EpubContents): void => {
              const selection = contents.window.getSelection();
              if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
              const quote = selection.toString().slice(0, 400);
              if (!quote.trim()) return;
              const point = popupPoint(contents, selection.getRangeAt(0).getBoundingClientRect());
              setEpubHighlightPopup({
                ...point,
                remove: false,
                action: async (color) => {
                  const highlight = await addUserHighlight({
                    documentId: props.documentId,
                    pageAnchor: cfiRange,
                    start: 0,
                    end: quote.length,
                    quote,
                    cfiRange,
                    ...(color ? { color } : {}),
                  });
                  annotate(highlight);
                  selection.removeAllRanges();
                  setEpubHighlightPopup(null);
                },
              });
            };
            rendition.on('selected', handleSelected);
            const navigation = await book.loaded.navigation;
            const outline = flattenEpubNavigation(navigation.toc);
            let navigationRequest = 0;
            const navigate = (href: string): void => {
              const request = ++navigationRequest;
              void rendition
                .display(href)
                .then(() => {
                  if (disposed || request !== navigationRequest) return;
                  const section = book.spine.get(href);
                  if (!section) return;
                  const frame = Array.from(host.querySelectorAll('iframe')).find(
                    (frame) => frame.parentElement?.getAttribute('ref') === String(section.index),
                  );
                  if (!frame) return;
                  const fragment = href.split('#')[1];
                  const target = fragment
                    ? frame.contentDocument?.getElementById(decodeURIComponent(fragment))
                    : null;
                  const chrome = host
                    .closest('.document-page')
                    ?.querySelector('.document-page__chrome');
                  window.scrollTo({
                    top:
                      window.scrollY +
                      frame.getBoundingClientRect().top +
                      (target?.getBoundingClientRect().top ?? 0) -
                      Math.max(0, chrome?.getBoundingClientRect().bottom ?? 0),
                    behavior: 'instant',
                  });
                })
                .catch(() => {
                  if (!disposed) toast.error('Не удалось перейти к выбранному разделу.');
                });
            };
            const handleRelocated = (location: EpubLocation): void => {
              const href = location.start?.href;
              if (!href) return;
              const anchor = findEpubOutlineAnchor(outline, href);
              if (anchor) props.onEpubActiveOutlineChange?.(anchor);
            };
            rendition.on('relocated', handleRelocated);
            rendition.themes.fontSize('100%');
            destroyBook = () => {
              rendition.off('selected', handleSelected);
              rendition.off('relocated', handleRelocated);
              void rendition.destroy();
              void book.destroy();
            };
            const savedHighlights = await loadUserHighlights(props.documentId);
            if (disposed) {
              destroyBook();
              return;
            }
            savedHighlights.forEach(annotate);
            void rendition
              .display()
              .then(() => {
                if (disposed) return;
                props.onEpubOutlineChange?.(outline);
                props.onEpubNavigateReady?.(navigate);
              })
              .catch(() => {
                if (!disposed) toast.error('Не удалось открыть EPUB-документ.');
              });
            return;
          }
          if (isPresentationMime(props.mimeType)) {
            const { init } = await import('pptx-preview');
            if (disposed) return;
            host.classList.add('rich-pptx');
            const previewer = init(host, {
              width: Math.round(host.clientWidth || 900),
              mode: 'list',
            });
            await previewer.preview(buffer);
            if (disposed) return;
            host.style.overflow = 'visible';
            const wrapper = host.querySelector<HTMLElement>('.pptx-preview-wrapper');
            wrapper?.classList.add('rich-pptx__wrapper');
            wrapper?.style.setProperty('height', 'auto');
            wrapper?.style.setProperty('overflow', 'visible');
            wrapper
              ?.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper')
              .forEach((slide, index) => {
                slide.classList.add('rich-pptx__slide');
                if (props.onPresentationSlideClick) {
                  slide.tabIndex = 0;
                  slide.setAttribute('role', 'button');
                  slide.setAttribute('aria-label', `Открыть слайд ${String(index + 1)} крупно`);
                  const openSlide = (): void => props.onPresentationSlideClick?.(slide);
                  slide.addEventListener('click', openSlide);
                  slide.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    openSlide();
                  });
                }
              });
            destroyBook = () => {
              host.replaceChildren();
            };
            return;
          }
          if (isDocxMime(props.mimeType)) {
            const docx = await import('docx-preview');
            if (disposed) return;
            host.classList.add('rich-docx');
            await docx.renderAsync(buffer, host, undefined, {
              inWrapper: true,
              breakPages: true,
              ignoreLastRenderedPageBreak: false,
            });
            const wrapper = host.querySelector<HTMLElement>('.docx-wrapper');
            wrapper?.classList.add('rich-docx__wrapper');
            wrapper?.querySelectorAll<HTMLElement>('section.docx').forEach((page, index) => {
              page.classList.add('rich-docx__page');
              page.id = pageAnchorId(props.documentId, index);
              page.setAttribute('data-user-doc-anchor', '');
              page.setAttribute('aria-label', `Страница ${String(index + 1)}`);
            });
          }
        } catch {
          if (!disposed) host.textContent = 'Не удалось отобразить документ в исходном виде.';
        }
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        host.textContent =
          cause instanceof Error ? cause.message : 'Не удалось загрузить документ в исходном виде.';
      });
    onCleanup(() => {
      disposed = true;
      window.removeEventListener('scroll', dismissHighlightPopup, { capture: true });
      props.onEpubOutlineChange?.([]);
      props.onEpubNavigateReady?.(null);
      document.documentElement.classList.remove('epub-page-scroll');
      destroyBook?.();
      host.replaceChildren();
    });
  });

  return (
    <>
      <div ref={host} class="rich-document-renderer" />
      <Show when={epubHighlightPopup()}>
        {(popup) => (
          <UserHighlightPopup
            x={popup().x}
            y={popup().y}
            onAdd={popup().remove ? undefined : (color) => popup().action(color)}
            onRemove={popup().remove ? () => popup().action() : undefined}
            onClose={() => setEpubHighlightPopup(null)}
          />
        )}
      </Show>
    </>
  );
}
