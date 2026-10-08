import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import {
  createUserScrollTracker,
  isScrollKey,
  type PopupPoint,
  popupPointForText,
} from '@/features/library/epub-popup-anchor';
import {
  appPrefersDark,
  EPUB_THEME_STYLE_KEY,
  epubThemeCss,
  readEpubThemeColors,
} from '@/features/library/epub-theme';
import { SpreadsheetRenderer } from '@/features/library/SpreadsheetRenderer';
import { UserHighlightPopup } from '@/features/library/UserHighlightPopup';
import {
  findEpubOutlineAnchor,
  flattenEpubNavigation,
  pageAnchorId,
  type UserDocumentOutlineItem,
  waitForStablePosition,
} from '@/features/library/user-document-reader-helpers';
import { subscribeTheme } from '@/state/theme';
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
  readonly addStylesheetCss: (css: string, key: string) => boolean;
}

interface EpubLocation {
  readonly start?: { readonly href?: string };
}

interface EpubHighlightPopup {
  readonly x: number;
  readonly y: number;
  /** Where its text is now; the popup follows it when the book scrolls by itself. */
  readonly anchor: () => PopupPoint | null;
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
    // The continuous view scrolls the page itself while it renders neighbouring chapters; only a
    // scroll the reader started closes the popup, any other one moves it with its text.
    const userScroll = createUserScrollTracker();
    const markUserGesture = (): void => userScroll.mark(performance.now());
    const markScrollKey = (event: KeyboardEvent): void => {
      if (isScrollKey(event.key)) markUserGesture();
    };
    let followFrame = 0;
    const followHighlightPopup = (): void => {
      followFrame = 0;
      const popup = epubHighlightPopup();
      if (!popup) return;
      const point = popup.anchor();
      setEpubHighlightPopup(point ? { ...popup, ...point } : null);
    };
    const dismissHighlightPopup = (event: Event): void => {
      if (
        event.target !== document &&
        event.target !== window &&
        event.target instanceof Node &&
        !host.contains(event.target)
      )
        return;
      if (!epubHighlightPopup()) return;
      if (userScroll.isUserScroll(performance.now())) {
        setEpubHighlightPopup(null);
        return;
      }
      if (!followFrame) followFrame = requestAnimationFrame(followHighlightPopup);
    };
    window.addEventListener('scroll', dismissHighlightPopup, { capture: true, passive: true });
    window.addEventListener('wheel', markUserGesture, { capture: true, passive: true });
    window.addEventListener('touchmove', markUserGesture, { capture: true, passive: true });
    window.addEventListener('keydown', markScrollKey, { capture: true });
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
            // The chapters follow the app theme (dark page and text in the dark theme), also
            // when the theme or the system colour scheme changes while a book is open.
            const applyAppTheme = (contents: EpubContents): void => {
              contents.addStylesheetCss(
                epubThemeCss(readEpubThemeColors(host)),
                EPUB_THEME_STYLE_KEY,
              );
            };
            rendition.hooks.content.register(applyAppTheme);
            const refreshAppTheme = (): void => {
              for (const contents of rendition.getContents() as unknown as readonly EpubContents[]) {
                applyAppTheme(contents);
              }
            };
            const stopThemeUpdates = subscribeTheme(refreshAppTheme);
            destroyBook = () => {
              stopThemeUpdates();
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
                    anchor: rangeAnchor(cfiRange),
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
                  // Multiplying a marker over a dark page would hide the text under it.
                  'fill-opacity': appPrefersDark() ? '0.4' : '0.55',
                  'mix-blend-mode': appPrefersDark() ? 'normal' : 'multiply',
                },
              );
            };
            const preventSelectedContextMenu = (contents: EpubContents): void => {
              contents.document.addEventListener('contextmenu', (event) => {
                if (!contents.window.getSelection()?.isCollapsed) event.preventDefault();
              });
            };
            rendition.hooks.content.register(preventSelectedContextMenu);
            // Wheel and touch over a chapter happen inside its iframe and never reach `window`.
            let reportUserScroll: (() => void) | null = null;
            rendition.hooks.content.register((contents: EpubContents) => {
              const report = (): void => reportUserScroll?.();
              contents.window.addEventListener('wheel', report, { passive: true });
              contents.window.addEventListener('touchstart', report, { passive: true });
              contents.window.addEventListener('wheel', markUserGesture, { passive: true });
              contents.window.addEventListener('touchmove', markUserGesture, { passive: true });
              contents.window.addEventListener('keydown', markScrollKey);
            });
            /** The current place of a book range on the page, or null once it is not shown. */
            const rangeAnchor = (cfiRange: string) => (): PopupPoint | null => {
              const range = rendition.getRange(cfiRange) as Range | undefined;
              const frame = range?.startContainer.ownerDocument?.defaultView?.frameElement;
              if (!range || !(frame instanceof HTMLElement) || !frame.isConnected) return null;
              return popupPointForText(
                frame.getBoundingClientRect(),
                range.getBoundingClientRect(),
                { width: window.innerWidth, height: window.innerHeight },
              );
            };
            const handleSelected = (cfiRange: string, contents: EpubContents): void => {
              const selection = contents.window.getSelection();
              if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
              const quote = selection.toString().slice(0, 400);
              if (!quote.trim()) return;
              const point = popupPoint(contents, selection.getRangeAt(0).getBoundingClientRect());
              setEpubHighlightPopup({
                ...point,
                anchor: rangeAnchor(cfiRange),
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
              const current = (): boolean => !disposed && request === navigationRequest;
              // A reader who starts scrolling takes over; the alignment below must not fight them.
              let userScrolled = false;
              const markUserScroll = (): void => {
                userScrolled = true;
              };
              // The continuous manager keeps rendering neighbouring chapters after display()
              // resolves, which moves the target several times; hide the text until it settles.
              host.classList.add('rich-document-renderer--navigating');
              reportUserScroll = markUserScroll;
              window.addEventListener('wheel', markUserScroll, { passive: true });
              window.addEventListener('touchstart', markUserScroll, { passive: true });
              const finish = (): void => {
                if (reportUserScroll === markUserScroll) reportUserScroll = null;
                window.removeEventListener('wheel', markUserScroll);
                window.removeEventListener('touchstart', markUserScroll);
                if (current()) host.classList.remove('rich-document-renderer--navigating');
              };
              void rendition
                .display(href)
                .then(async () => {
                  if (!current()) return;
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
                  const documentTop = (): number =>
                    window.scrollY +
                    frame.getBoundingClientRect().top +
                    (target?.getBoundingClientRect().top ?? 0);
                  const settledTop = await waitForStablePosition(documentTop, () =>
                    Boolean(current() && !userScrolled),
                  );
                  if (settledTop === null) return;
                  const chrome = host
                    .closest('.document-page')
                    ?.querySelector('.document-page__chrome');
                  window.scrollTo({
                    top: settledTop - Math.max(0, chrome?.getBoundingClientRect().bottom ?? 0),
                    behavior: 'instant',
                  });
                })
                .catch(() => {
                  if (current()) toast.error('Не удалось перейти к выбранному разделу.');
                })
                .finally(finish);
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
              stopThemeUpdates();
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
      window.removeEventListener('wheel', markUserGesture, { capture: true });
      window.removeEventListener('touchmove', markUserGesture, { capture: true });
      window.removeEventListener('keydown', markScrollKey, { capture: true });
      if (followFrame) cancelAnimationFrame(followFrame);
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
