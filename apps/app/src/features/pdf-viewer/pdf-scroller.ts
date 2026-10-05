/**
 * The scrolling box that holds a PDF's pages: the nearest ancestor that really scrolls, or the
 * window. The reader pages scroll the window, a dialog scrolls its own panel, so the viewer asks
 * instead of assuming.
 */

export interface PdfScroller {
  /** Null when the window scrolls. */
  readonly element: HTMLElement | null;
  /** The visible rectangle in client coordinates. */
  rect(): DOMRect;
  scrollBy(top: number, left?: number): void;
  scrollTopNow(): number;
  scrollLeftNow(): number;
}

function scrollsVertically(element: HTMLElement): boolean {
  const overflowY = getComputedStyle(element).overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
  return element.scrollHeight > element.clientHeight + 1;
}

const WINDOW_SCROLLER: PdfScroller = {
  element: null,
  rect: () => new DOMRect(0, 0, window.innerWidth, window.innerHeight),
  scrollBy: (top, left = 0) => window.scrollBy({ top, left, behavior: 'instant' }),
  scrollTopNow: () => window.scrollY,
  scrollLeftNow: () => window.scrollX,
};

export function findPdfScroller(from: HTMLElement | undefined): PdfScroller {
  let element = from?.parentElement ?? null;
  while (element && element !== document.body && element !== document.documentElement) {
    if (scrollsVertically(element) || element.hasAttribute('data-pdf-scroller')) {
      const found = element;
      return {
        element: found,
        rect: () => found.getBoundingClientRect(),
        scrollBy: (top, left = 0) => found.scrollBy({ top, left, behavior: 'instant' }),
        scrollTopNow: () => found.scrollTop,
        scrollLeftNow: () => found.scrollLeft,
      };
    }
    element = element.parentElement;
  }
  return WINDOW_SCROLLER;
}

/** Height of the reader's own header, which covers the top of the page while it is shown. */
export function readerChromeHeight(from: HTMLElement | undefined): number {
  const chrome = from
    ?.closest('.document-page')
    ?.querySelector<HTMLElement>('.document-page__chrome');
  return chrome ? chrome.offsetHeight : 0;
}
