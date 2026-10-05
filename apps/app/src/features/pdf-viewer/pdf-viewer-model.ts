import { type Accessor, batch, createMemo, createSignal, onCleanup } from 'solid-js';

import type { DocumentFindResultState } from '@/features/library/DocumentFindBar';
import type { DocumentFindUnit } from '@/features/library/document-find';
import { PdfHighlightRegistry } from '@/features/pdf-viewer/pdf-find-dom';
import {
  NO_PDF_FIND_HIGHLIGHTS,
  type PdfFindHighlights,
  pdfFindHighlights,
  pdfPageFindUnits,
} from '@/features/pdf-viewer/pdf-find-state';
import {
  buildPdfPageText,
  type PdfPageText,
  pdfPageHasText,
} from '@/features/pdf-viewer/pdf-page-text';
import {
  loadPdfPosition,
  mostVisiblePage,
  type PdfFitMode,
  type PdfReadingPosition,
  readingPositionFromRects,
  savePdfPosition,
} from '@/features/pdf-viewer/pdf-position';
import { PdfRenderQueue } from '@/features/pdf-viewer/pdf-render-queue';
import { findPdfScroller, readerChromeHeight } from '@/features/pdf-viewer/pdf-scroller';
import { ThumbnailBudget } from '@/features/pdf-viewer/pdf-thumbnail-budget';
import {
  clampPdfZoom,
  fitPageZoom,
  stepPdfZoom,
  wheelZoomFactor,
} from '@/features/pdf-viewer/pdf-zoom';
import { loadPdfJsDocument, type PdfDocumentProxy } from '@/state/pdfjs-document';
import { holdReaderChrome } from '@/state/reader-chrome-hold';

/** A4 portrait, until the page's own size is read. */
const DEFAULT_ASPECT = 210 / 297;
/** Gap between the reading line and the top of the visible area (below the reader header). */
const READING_LINE_GAP_PX = 16;
const SIZE_BATCH = 24;
const TEXT_BATCH = 6;
/** Page thumbnails of one document may hold this many bytes of canvas at most. */
const THUMBNAIL_BUDGET_BYTES = 6 * 1024 * 1024;
/** Bitmaps of drawn pages (RGBA): about eight 0.75-megapixel pages, more only while visible. */
const PAGE_BUDGET_BYTES = 24 * 1024 * 1024;
const POSITION_SAVE_DELAY_MS = 600;
/** How long a restored position is kept in place while the page layout settles. */
const SETTLE_MS = 1500;
const TEXT_PREFETCH_DELAY_MS = 2500;
const TEXT_PREFETCH_MAX_PAGES = 600;

export interface PdfViewerModelOptions {
  /** Stable id of the file (`user:<id>`, `note:<id>`); without it the position is not remembered. */
  readonly resumeKey?: Accessor<string | undefined>;
  /** 1-based page to open at; it wins over the remembered position. */
  readonly initialPage?: Accessor<number | undefined>;
}

export interface PdfViewerModel {
  readonly pdf: Accessor<PdfDocumentProxy | null>;
  readonly pageCount: Accessor<number>;
  readonly loading: Accessor<boolean>;
  readonly error: Accessor<string | null>;
  /** Width / height of a 0-based page; the first page's until the page's own size is known. */
  readonly aspect: (pageIndex: number) => number;
  readonly currentPage: Accessor<number>;
  readonly zoom: Accessor<number>;
  readonly fit: Accessor<PdfFitMode>;
  readonly queue: PdfRenderQueue;
  readonly thumbnailBudget: ThumbnailBudget;
  /** Memory cap for the drawn page bitmaps themselves. */
  readonly pageBudget: ThumbnailBudget;
  readonly highlights: PdfHighlightRegistry;
  readonly findHighlights: Accessor<PdfFindHighlights>;
  readonly findUnits: Accessor<readonly DocumentFindUnit[]>;
  /** True while a search waits for the text of the remaining pages. */
  readonly findBusy: Accessor<boolean>;
  /** 0-based pages known to have no text layer (scans); empty until their text was read. */
  readonly textlessPages: Accessor<ReadonlySet<number>>;
  load(blob: Blob): Promise<void>;
  /** The element holding the pages (and its horizontally scrolling wrapper). */
  setRoot(root: HTMLElement | undefined, columns: HTMLElement | undefined): void;
  goToPage(page: number, fraction?: number): void;
  stepPage(delta: number): void;
  setZoom(zoom: number, anchor?: { readonly clientX: number; readonly clientY: number }): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  /** Starts reading the text of every page (idempotent). */
  beginFind(): void;
  setFindState(state: DocumentFindResultState): void;
  pageText(pageIndex: number): PdfPageText | undefined;
  /** Called by a page once its text layer and highlights are in the DOM. */
  notifyTextLayer(pageIndex: number): void;
  /** Distance of a page's centre from the visible centre, for render priority. */
  distanceFromCenter(element: HTMLElement): number;
  /** The original file, for print and «Открыть в системе». */
  readonly blob: Accessor<Blob | null>;
  dispose(): void;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

interface PendingStart {
  readonly page: number;
  readonly fraction: number;
  readonly zoom?: number;
  readonly fit?: PdfFitMode;
}

export function createPdfViewerModel(options: PdfViewerModelOptions = {}): PdfViewerModel {
  const [pdf, setPdf] = createSignal<PdfDocumentProxy | null>(null);
  const [blob, setBlob] = createSignal<Blob | null>(null);
  const [pageCount, setPageCount] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [aspects, setAspects] = createSignal<readonly number[]>([]);
  const [currentPage, setCurrentPage] = createSignal(1);
  const [zoom, setZoomValue] = createSignal(1);
  const [fit, setFit] = createSignal<PdfFitMode>('width');
  const [findRequested, setFindRequested] = createSignal(false);
  const [textVersion, setTextVersion] = createSignal(0);
  const [textRead, setTextRead] = createSignal(0);
  const [findHighlightState, setFindHighlightState] =
    createSignal<PdfFindHighlights>(NO_PDF_FIND_HIGHLIGHTS);

  const queue = new PdfRenderQueue(2);
  const thumbnailBudget = new ThumbnailBudget(THUMBNAIL_BUDGET_BYTES);
  const pageBudget = new ThumbnailBudget(PAGE_BUDGET_BYTES);
  const highlights = new PdfHighlightRegistry();
  const pageTexts = new Map<number, PdfPageText>();

  let activePdf: PdfDocumentProxy | null = null;
  let loadGeneration = 0;
  let root: HTMLElement | undefined;
  let columns: HTMLElement | undefined;
  let knownSizes = 0;
  let sizeWaiters: { readonly upTo: number; readonly resolve: () => void }[] = [];
  let pendingStart: PendingStart | undefined;
  let tracking = false;
  /** After a restore the layout may still shift; keep the target in place until it settles. */
  let settleTarget: { readonly page: number; readonly fraction: number } | undefined;
  let settleUntil = 0;
  let readingFrame: number | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  let textGeneration = 0;
  let textPromise: Promise<void> | undefined;
  let revealPage: number | undefined;
  let lastRevealKey = '';
  let disposed = false;
  let cleanups: (() => void)[] = [];

  const aspect = (pageIndex: number): number =>
    aspects()[pageIndex] ?? aspects()[0] ?? DEFAULT_ASPECT;

  // ---- geometry -------------------------------------------------------------------------

  const pageElements = (): readonly HTMLElement[] =>
    root ? Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-page]')) : [];

  const readingLineY = (): number => {
    const scroller = findPdfScroller(root);
    return scroller.rect().top + readerChromeHeight(root) + READING_LINE_GAP_PX;
  };

  const readingPoint = (line = readingLineY()): { page: number; fraction: number } => {
    const rects = pageElements().map((element) => element.getBoundingClientRect());
    return readingPositionFromRects(rects, line);
  };

  /** The page that fills most of the visible area; the left one of a two-page spread. */
  const visiblePage = (): number => {
    const rects = pageElements().map((element) => element.getBoundingClientRect());
    const view = findPdfScroller(root).rect();
    let index = mostVisiblePage(rects, view.top + readerChromeHeight(root), view.bottom) - 1;
    const row = rects[index];
    while (index > 0 && row && Math.abs((rects[index - 1]?.top ?? Number.NaN) - row.top) < 1) {
      index -= 1;
    }
    return index + 1;
  };

  const scrollToPoint = (page: number, fraction: number, line = readingLineY()): void => {
    const element = pageElements()[page - 1];
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const delta = rect.top + fraction * rect.height - line;
    if (Math.abs(delta) < 0.5) return;
    findPdfScroller(root).scrollBy(delta);
  };

  const reanchor = (): void => {
    if (!settleTarget) return;
    if (performance.now() > settleUntil) {
      settleTarget = undefined;
      return;
    }
    scrollToPoint(settleTarget.page, settleTarget.fraction);
  };

  const distanceFromCenter = (element: HTMLElement): number => {
    const view = findPdfScroller(root).rect();
    const rect = element.getBoundingClientRect();
    return Math.abs(rect.top + rect.height / 2 - (view.top + view.height / 2));
  };

  // ---- reading position -----------------------------------------------------------------

  const currentPosition = (): PdfReadingPosition => {
    const point = readingPoint();
    return {
      page: point.page,
      fraction: point.fraction,
      zoom: zoom(),
      fit: fit(),
      savedAt: Date.now(),
    };
  };

  const savePositionNow = (): void => {
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = undefined;
    const key = options.resumeKey?.();
    if (!key || !tracking || pageCount() === 0 || !root?.isConnected) return;
    savePdfPosition(key, currentPosition());
  };

  const savePositionSoon = (): void => {
    if (!options.resumeKey?.()) return;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(savePositionNow, POSITION_SAVE_DELAY_MS);
  };

  const updateReading = (): void => {
    readingFrame = undefined;
    if (!root?.isConnected || pageCount() === 0) return;
    if (!tracking) return;
    const page = visiblePage();
    if (page !== currentPage()) setCurrentPage(page);
    // While a restored position settles, the position is not yet the user's own.
    if (settleTarget && performance.now() < settleUntil) return;
    settleTarget = undefined;
    savePositionSoon();
  };

  const scheduleReading = (): void => {
    if (readingFrame !== undefined) return;
    readingFrame = requestAnimationFrame(updateReading);
  };

  const waitForSizes = (upTo: number): Promise<void> => {
    if (knownSizes >= upTo) return Promise.resolve();
    return new Promise((resolve) => {
      sizeWaiters.push({ upTo, resolve });
    });
  };

  const releaseSizeWaiters = (): void => {
    const ready = sizeWaiters.filter((waiter) => knownSizes >= waiter.upTo);
    sizeWaiters = sizeWaiters.filter((waiter) => knownSizes < waiter.upTo);
    for (const waiter of ready) waiter.resolve();
  };

  const applyStart = async (generation: number): Promise<void> => {
    const start = pendingStart;
    if (!start || !root || pageCount() === 0) return;
    pendingStart = undefined;
    const page = Math.min(Math.max(1, start.page), pageCount());
    if (start.fit === 'page') {
      applyFit('page');
    } else if (start.zoom !== undefined) {
      setFit(start.fit ?? 'custom');
      setZoomValue(clampPdfZoom(start.zoom));
    }
    await waitForSizes(page);
    await nextFrame();
    await nextFrame();
    if (generation !== loadGeneration || disposed) return;
    holdReaderChrome();
    scrollToPoint(page, start.fraction);
    setCurrentPage(page);
    settleTarget = { page, fraction: start.fraction };
    settleUntil = performance.now() + SETTLE_MS;
    tracking = true;
    scheduleReading();
  };

  // ---- zoom -----------------------------------------------------------------------------

  const visibleHeight = (): number => {
    const view = findPdfScroller(root).rect();
    return view.height - readerChromeHeight(root);
  };

  const columnWidth = (): number => columns?.clientWidth ?? root?.clientWidth ?? 0;

  const applyFit = (mode: PdfFitMode): void => {
    if (mode === 'width') {
      setFit('width');
      setZoomValue(1);
      return;
    }
    if (mode === 'page') {
      setFit('page');
      setZoomValue(fitPageZoom(visibleHeight(), columnWidth(), aspect(currentPage() - 1)));
    }
  };

  const setZoom: PdfViewerModel['setZoom'] = (next, anchor) => {
    const clamped = clampPdfZoom(next);
    if (Math.abs(clamped - zoom()) < 0.0005) return;
    const line = anchor?.clientY ?? readingLineY();
    const point = readingPoint(line);
    const view = columns;
    const horizontalAnchor =
      anchor?.clientX ?? (view ? view.getBoundingClientRect().left + view.clientWidth / 2 : 0);
    const ratioX = view
      ? (view.scrollLeft + horizontalAnchor - view.getBoundingClientRect().left) /
        Math.max(1, view.scrollWidth)
      : 0;
    batch(() => {
      setFit('custom');
      setZoomValue(clamped);
    });
    scrollToPoint(point.page, point.fraction, line);
    if (view) {
      view.scrollLeft =
        ratioX * view.scrollWidth - (horizontalAnchor - view.getBoundingClientRect().left);
    }
    scheduleReading();
  };

  const fitWidth = (): void => {
    const line = readingLineY();
    const point = readingPoint(line);
    applyFit('width');
    scrollToPoint(point.page, point.fraction, line);
    if (columns) columns.scrollLeft = 0;
    scheduleReading();
  };

  const fitPage = (): void => {
    const point = readingPoint();
    applyFit('page');
    scrollToPoint(point.page, 0);
    if (columns) columns.scrollLeft = 0;
    scheduleReading();
  };

  // ---- page sizes -----------------------------------------------------------------------

  const loadPageSizes = async (document: PdfDocumentProxy, generation: number): Promise<void> => {
    const total = document.numPages;
    const values: number[] = [];
    for (let start = 0; start < total; start += SIZE_BATCH) {
      const end = Math.min(total, start + SIZE_BATCH);
      try {
        const batchValues = await Promise.all(
          Array.from({ length: end - start }, async (_, offset) => {
            const page = await document.getPage(start + offset + 1);
            const viewport = page.getViewport({ scale: 1 });
            page.cleanup();
            return viewport.height > 0 ? viewport.width / viewport.height : DEFAULT_ASPECT;
          }),
        );
        if (generation !== loadGeneration) return;
        values.push(...batchValues);
      } catch (cause) {
        if (generation !== loadGeneration) return;
        console.warn('PDF page sizes could not be read.', cause);
        return;
      }
      setAspects([...values]);
      knownSizes = end;
      releaseSizeWaiters();
      reanchor();
      if (end < total) await yieldToMain();
    }
  };

  // ---- text and find --------------------------------------------------------------------

  const findUnits = createMemo((): readonly DocumentFindUnit[] => {
    textVersion();
    return pdfPageFindUnits(pageTexts);
  });

  const findBusy = createMemo(() => findRequested() && textRead() < pageCount());

  const textlessPages = createMemo((): ReadonlySet<number> => {
    textVersion();
    const result = new Set<number>();
    for (const [index, text] of pageTexts) if (!pdfPageHasText(text)) result.add(index);
    return result;
  });

  const extractTexts = (): Promise<void> => {
    if (textPromise) return textPromise;
    const document = activePdf;
    if (!document) return Promise.resolve();
    const generation = textGeneration;
    const total = document.numPages;
    textPromise = (async () => {
      for (let start = 0; start < total; start += TEXT_BATCH) {
        const end = Math.min(total, start + TEXT_BATCH);
        try {
          const batchTexts = await Promise.all(
            Array.from({ length: end - start }, async (_, offset) => {
              const page = await document.getPage(start + offset + 1);
              try {
                const content = await page.getTextContent();
                return buildPdfPageText(
                  content.items as readonly { str?: string; hasEOL?: boolean }[],
                );
              } finally {
                page.cleanup();
              }
            }),
          );
          if (generation !== textGeneration) return;
          batchTexts.forEach((text, offset) => {
            pageTexts.set(start + offset, text);
          });
        } catch (cause) {
          if (generation !== textGeneration) return;
          console.warn('PDF text could not be read for search.', cause);
          return;
        }
        batch(() => {
          setTextRead(end);
          setTextVersion((version) => version + 1);
        });
        if (end < total) await yieldToMain();
      }
    })();
    return textPromise;
  };

  const beginFind = (): void => {
    setFindRequested(true);
    void extractTexts();
  };

  const scrollRangeIntoView = (range: Range): void => {
    holdReaderChrome();
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const scroller = findPdfScroller(root);
    const view = scroller.rect();
    const top = view.top + readerChromeHeight(root);
    // Leave room for the page dock at the bottom.
    const bottom = view.bottom - 72;
    if (rect.top < top + 24 || rect.bottom > bottom - 24) {
      scroller.scrollBy(rect.top - (top + (bottom - top) / 2));
    }
    if (columns) {
      const box = columns.getBoundingClientRect();
      if (rect.left < box.left + 8 || rect.right > box.right - 8) {
        columns.scrollBy({
          left: rect.left - (box.left + box.width / 2),
          behavior: 'instant',
        });
      }
    }
  };

  const revealActive = (pageIndex: number): void => {
    const range = highlights.activeRange(pageIndex);
    if (!range) return;
    revealPage = undefined;
    scrollRangeIntoView(range);
  };

  const setFindState = (state: DocumentFindResultState): void => {
    const next = pdfFindHighlights(state.matches, state.activeIndex);
    setFindHighlightState(next);
    if (state.loading || state.matches.length === 0 || next.activePage === undefined) {
      revealPage = undefined;
      lastRevealKey = '';
      return;
    }
    const active = state.matches[state.activeIndex];
    if (!active) return;
    const key = `${state.query}|${active.unitId}|${String(active.start)}|${String(state.activeIndex)}`;
    if (key === lastRevealKey) return;
    lastRevealKey = key;
    const pageIndex = next.activePage;
    if (highlights.activeRange(pageIndex)) {
      revealActive(pageIndex);
      return;
    }
    // The page is not rendered yet: bring it near, then place the match once its text layer exists.
    revealPage = pageIndex;
    const text = pageTexts.get(pageIndex)?.text.length ?? 0;
    goToPage(pageIndex + 1, text > 0 ? active.start / text : 0);
  };

  const notifyTextLayer = (pageIndex: number): void => {
    if (revealPage === pageIndex) revealActive(pageIndex);
  };

  // ---- navigation -----------------------------------------------------------------------

  const goToPage = (page: number, fraction = 0): void => {
    holdReaderChrome();
    const target = Math.min(Math.max(1, Math.round(page)), Math.max(1, pageCount()));
    scrollToPoint(target, fraction);
    setCurrentPage(target);
    scheduleReading();
  };

  const stepPage = (delta: number): void => {
    goToPage(currentPage() + delta);
  };

  // ---- DOM wiring -----------------------------------------------------------------------

  const attachListeners = (element: HTMLElement): (() => void) => {
    const onScroll = (): void => scheduleReading();
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('pagehide', savePositionNow);

    let wheelFrame: number | undefined;
    let wheelTarget = 1;
    let wheelAnchor = { clientX: 0, clientY: 0 };
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      wheelAnchor = { clientX: event.clientX, clientY: event.clientY };
      wheelTarget *= wheelZoomFactor(event.deltaY, event.deltaMode);
      if (wheelFrame !== undefined) return;
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = undefined;
        const factor = wheelTarget;
        wheelTarget = 1;
        setZoom(zoom() * factor, wheelAnchor);
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))
      ) {
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoom(stepPdfZoom(zoom(), 1));
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setZoom(stepPdfZoom(zoom(), -1));
      } else if (event.key === '0') {
        event.preventDefault();
        fitWidth();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Two-finger pinch on touch screens.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { distance: number; zoom: number } | undefined;
    let pinchFrame: number | undefined;
    const pinchDistance = (): number => {
      const [first, second] = [...touches.values()];
      return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
    };
    const pinchCentre = (): { clientX: number; clientY: number } => {
      const [first, second] = [...touches.values()];
      return first && second
        ? { clientX: (first.x + second.x) / 2, clientY: (first.y + second.y) / 2 }
        : { clientX: 0, clientY: 0 };
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) pinch = { distance: pinchDistance(), zoom: zoom() };
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size !== 2 || !pinch || pinch.distance <= 0) return;
      if (pinchFrame !== undefined) return;
      pinchFrame = requestAnimationFrame(() => {
        pinchFrame = undefined;
        if (!pinch || touches.size !== 2) return;
        setZoom(pinch.zoom * (pinchDistance() / pinch.distance), pinchCentre());
      });
    };
    const onPointerEnd = (event: PointerEvent): void => {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinch = undefined;
    };
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerEnd);
    element.addEventListener('pointercancel', onPointerEnd);

    // Fit-page follows the window: a rotated phone or a resized pane refits. A layout shift right
    // after a restore moves the restored point back to where it was.
    const resize = new ResizeObserver(() => {
      if (fit() === 'page') applyFit('page');
      reanchor();
    });
    resize.observe(element);
    if (root) resize.observe(root);
    const userMoved = (): void => {
      settleTarget = undefined;
    };
    const userEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const name of userEvents) window.addEventListener(name, userMoved, { passive: true });

    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pagehide', savePositionNow);
      window.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
      resize.disconnect();
      for (const name of userEvents) window.removeEventListener(name, userMoved);
      if (wheelFrame !== undefined) cancelAnimationFrame(wheelFrame);
      if (pinchFrame !== undefined) cancelAnimationFrame(pinchFrame);
    };
  };

  const setRoot: PdfViewerModel['setRoot'] = (nextRoot, nextColumns) => {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    root = nextRoot;
    columns = nextColumns;
    if (!nextRoot) return;
    cleanups.push(attachListeners(nextColumns ?? nextRoot));
    void applyStart(loadGeneration);
  };

  // ---- loading --------------------------------------------------------------------------

  const resetDocumentState = (): void => {
    textGeneration += 1;
    textPromise = undefined;
    pageTexts.clear();
    highlights.clear();
    thumbnailBudget.clear();
    pageBudget.clear();
    knownSizes = 0;
    sizeWaiters = [];
    tracking = false;
    revealPage = undefined;
    lastRevealKey = '';
    if (prefetchTimer !== undefined) clearTimeout(prefetchTimer);
    batch(() => {
      setAspects([]);
      setTextRead(0);
      setTextVersion((version) => version + 1);
      setFindRequested(false);
      setFindHighlightState(NO_PDF_FIND_HIGHLIGHTS);
      setCurrentPage(1);
      setZoomValue(1);
      setFit('width');
    });
  };

  const load = async (file: Blob): Promise<void> => {
    const generation = ++loadGeneration;
    setLoading(true);
    setError(null);
    try {
      const next = await loadPdfJsDocument(file);
      if (generation !== loadGeneration || disposed) {
        await next.destroy();
        return;
      }
      const previous = activePdf;
      savePositionNow();
      activePdf = next;
      resetDocumentState();
      const key = options.resumeKey?.();
      const explicit = options.initialPage?.();
      const saved = key ? loadPdfPosition(key) : undefined;
      // A first open stays where the page is; only an explicit page or a saved position scrolls.
      pendingStart =
        explicit !== undefined
          ? { page: explicit, fraction: 0 }
          : saved
            ? { page: saved.page, fraction: saved.fraction, zoom: saved.zoom, fit: saved.fit }
            : undefined;
      tracking = pendingStart === undefined;
      batch(() => {
        setBlob(file);
        setPdf(next);
        setPageCount(next.numPages);
      });
      void loadPageSizes(next, generation);
      void applyStart(generation);
      if (next.numPages <= TEXT_PREFETCH_MAX_PAGES) {
        prefetchTimer = setTimeout(() => void extractTexts(), TEXT_PREFETCH_DELAY_MS);
      }
      if (previous && previous !== next) await previous.destroy();
    } catch (cause) {
      if (generation !== loadGeneration) return;
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть PDF.');
    } finally {
      if (generation === loadGeneration) setLoading(false);
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    savePositionNow();
    disposed = true;
    loadGeneration += 1;
    textGeneration += 1;
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    if (readingFrame !== undefined) cancelAnimationFrame(readingFrame);
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    if (prefetchTimer !== undefined) clearTimeout(prefetchTimer);
    queue.dispose();
    highlights.clear();
    thumbnailBudget.clear();
    pageBudget.clear();
    const document = activePdf;
    activePdf = null;
    setPdf(null);
    if (document) void document.destroy();
  };

  onCleanup(dispose);

  return {
    pdf,
    blob,
    pageCount,
    loading,
    error,
    aspect,
    currentPage,
    zoom,
    fit,
    queue,
    thumbnailBudget,
    pageBudget,
    highlights,
    findHighlights: findHighlightState,
    findUnits,
    findBusy,
    textlessPages,
    load,
    setRoot,
    goToPage,
    stepPage,
    setZoom,
    zoomIn: () => setZoom(stepPdfZoom(zoom(), 1)),
    zoomOut: () => setZoom(stepPdfZoom(zoom(), -1)),
    fitWidth,
    fitPage,
    beginFind,
    setFindState,
    pageText: (pageIndex) => pageTexts.get(pageIndex),
    notifyTextLayer,
    distanceFromCenter,
    dispose,
  };
}
