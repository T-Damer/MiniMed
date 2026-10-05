import { buildPdfPageHighlight } from '@/features/pdf-viewer/pdf-find-dom';
import type { PdfRenderTicket } from '@/features/pdf-viewer/pdf-render-queue';
import { PdfTextLayerBuilder } from '@/features/pdf-viewer/pdf-text-layer-builder';
import type { PdfViewerModel } from '@/features/pdf-viewer/pdf-viewer-model';
import type { PdfDocumentProxy } from '@/state/pdfjs-document';

/** One canvas never exceeds this many pixels, so a phone holds only a few megabytes per page. */
const PDF_MAX_CANVAS_PIXELS = 2_500_000;
const PAGE_RELEASE_DELAY_MS = 1_200;
const RESIZE_SETTLE_MS = 220;
/** The text layer is built once the page has stayed on screen this long. */
const TEXT_LAYER_SETTLE_MS = 250;
const CLEANUP_DELAY_MS = 250;
const CLEANUP_RETRY_DELAY_MS = 600;
/** Render again when the displayed width drifts this far from the rendered resolution. */
const RERENDER_TOLERANCE = 0.14;

const cleanupTimers = new WeakMap<PdfDocumentProxy, ReturnType<typeof setTimeout>>();
const CLEANUP_RETRY_LIMIT = 12;

/**
 * Frees what pdf.js keeps per page (operator lists, fonts) once nothing is drawing. It throws while
 * any page renders, which during scrolling is nearly always, so it retries until a quiet moment.
 */
export function schedulePdfCleanup(pdf: PdfDocumentProxy, attempt = 0): void {
  const current = cleanupTimers.get(pdf);
  if (current) clearTimeout(current);
  cleanupTimers.set(
    pdf,
    setTimeout(
      () => {
        cleanupTimers.delete(pdf);
        void pdf.cleanup().catch((cause: unknown) => {
          if (cause instanceof Error && cause.message.includes('currently rendering')) {
            if (attempt < CLEANUP_RETRY_LIMIT) schedulePdfCleanup(pdf, attempt + 1);
            return;
          }
          console.warn('PDF cleanup failed.', cause);
        });
      },
      attempt === 0 ? CLEANUP_DELAY_MS : CLEANUP_RETRY_DELAY_MS,
    ),
  );
}

function renderOversample(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(2, Math.max(1.25, ratio));
}

export interface PdfPageRendererParts {
  readonly model: PdfViewerModel;
  readonly pageIndex: number;
  readonly surface: HTMLElement;
  readonly canvasHost: HTMLElement;
  readonly textHost: HTMLElement;
  readonly canvasId?: string | undefined;
  readonly onError?: ((cause: unknown) => void) | undefined;
}

/**
 * Draws one PDF page lazily: only while it is near the viewport, through the shared render queue,
 * with the new bitmap swapped in after it is complete (no blank flash on zoom), a selectable text
 * layer, and find highlights. Everything is released shortly after the page leaves the screen.
 */
export class PdfPageRenderer {
  private readonly parts: PdfPageRendererParts;
  private visible = false;
  private canvas: HTMLCanvasElement | undefined;
  private renderedTarget = 0;
  private ticket: PdfRenderTicket | undefined;
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly textLayer: PdfTextLayerBuilder;
  private textTimer: ReturnType<typeof setTimeout> | undefined;
  private textGeneration = 0;
  private textPageWidth = 0;
  private observer: IntersectionObserver | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private disposed = false;

  constructor(parts: PdfPageRendererParts) {
    this.parts = parts;
    this.textLayer = new PdfTextLayerBuilder(parts.textHost);
    const touch =
      navigator.maxTouchPoints > 0 ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        this.setVisible(Boolean(entry?.isIntersecting));
      },
      { rootMargin: touch ? '250px 0px' : '900px 0px' },
    );
    this.observer.observe(parts.surface);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(parts.surface);
  }

  private get model(): PdfViewerModel {
    return this.parts.model;
  }

  private surfaceWidth(): number {
    return this.parts.surface.clientWidth;
  }

  setVisible(next: boolean): void {
    if (this.disposed || next === this.visible) return;
    this.visible = next;
    this.model.pageBudget.setVisible(this.parts.pageIndex, next);
    if (next) {
      if (this.releaseTimer) {
        clearTimeout(this.releaseTimer);
        this.releaseTimer = undefined;
      }
      this.requestRender();
      return;
    }
    // Off screen: a render still waiting or running is cancelled now, a finished page is released
    // after a short grace so a small scroll back does not redraw it.
    if (this.ticket) {
      this.ticket.cancel();
      this.ticket = undefined;
    }
    if (this.canvas) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = undefined;
        if (!this.visible) this.release();
      }, PAGE_RELEASE_DELAY_MS);
    }
  }

  /** A different document was loaded: nothing drawn so far belongs to it. */
  documentChanged(): void {
    this.ticket?.cancel();
    this.ticket = undefined;
    this.release();
    if (this.visible) this.requestRender();
  }

  private needsRender(): boolean {
    const width = this.surfaceWidth();
    if (width <= 0) return false;
    if (!this.canvas) return true;
    const target = width;
    return (
      Math.abs(target - this.renderedTarget) / Math.max(1, this.renderedTarget) > RERENDER_TOLERANCE
    );
  }

  private requestRender(): void {
    if (this.disposed || !this.visible || this.ticket || !this.model.pdf()) return;
    if (!this.needsRender()) return;
    const { surface } = this.parts;
    this.ticket = this.model.queue.enqueue({
      priority: () => this.model.distanceFromCenter(surface),
      run: (signal) => this.render(signal),
      onError: (cause) => this.parts.onError?.(cause),
    });
  }

  private async render(signal: AbortSignal): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.renderPage(signal);
    } finally {
      // User Timing entries let a profiler (and the phone-performance spec) see page draw times.
      if (this.canvas && !signal.aborted) {
        performance.measure('pdf-page-render', {
          start: startedAt,
          detail: { page: this.parts.pageIndex + 1 },
        });
      }
    }
  }

  private async renderPage(signal: AbortSignal): Promise<void> {
    const pdf = this.model.pdf();
    if (!pdf) return;
    const page = await pdf.getPage(this.parts.pageIndex + 1);
    try {
      if (signal.aborted || !this.visible) return;
      const width = this.surfaceWidth();
      if (width <= 0) return;
      const base = page.getViewport({ scale: 1 });
      const cssScale = width / base.width;
      const pixelScale = Math.sqrt(PDF_MAX_CANVAS_PIXELS / (base.width * base.height));
      const viewport = page.getViewport({
        scale: Math.min(cssScale * renderOversample(), pixelScale),
      });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-viewer__canvas';
      if (this.parts.canvasId) canvas.id = this.parts.canvasId;
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) return;
      const task = page.render({ canvasContext: context, viewport, canvas });
      const abort = (): void => task.cancel();
      signal.addEventListener('abort', abort, { once: true });
      try {
        await task.promise;
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'RenderingCancelledException') return;
        throw cause;
      } finally {
        signal.removeEventListener('abort', abort);
      }
      if (signal.aborted || !this.visible || this.disposed) {
        canvas.width = 1;
        canvas.height = 1;
        schedulePdfCleanup(pdf);
        return;
      }
      this.parts.canvasHost.replaceChildren(canvas);
      this.canvas = canvas;
      this.renderedTarget = width;
      // Count the bitmap against the viewer's budget; the least recently seen pages go first.
      this.model.pageBudget.add(this.parts.pageIndex, {
        bytes: canvas.width * canvas.height * 4,
        release: () => this.release(),
      });
      this.model.pageBudget.setVisible(this.parts.pageIndex, this.visible);
      this.textPageWidth = base.width;
      this.scheduleTextLayer();
    } finally {
      page.cleanup();
      this.ticket = undefined;
      // The page may have been resized while it drew.
      if (this.visible && !this.disposed) queueMicrotask(() => this.requestRender());
    }
  }

  /** (Re)builds the text layer once the page has settled; a resize only rescales the old one. */
  private scheduleTextLayer(): void {
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = setTimeout(() => {
      this.textTimer = undefined;
      void this.runTextLayer();
    }, TEXT_LAYER_SETTLE_MS);
  }

  private async runTextLayer(): Promise<void> {
    const pdf = this.model.pdf();
    const width = this.surfaceWidth();
    if (!pdf || !this.visible || this.disposed || width <= 0) return;
    const built = this.textLayer.layoutWidth;
    if (built > 0 && Math.abs(width - built) / built <= RERENDER_TOLERANCE) {
      this.updateTextLayerViewport();
      return;
    }
    const generation = ++this.textGeneration;
    try {
      const done = await this.textLayer.build(
        pdf,
        this.parts.pageIndex + 1,
        width,
        () => generation !== this.textGeneration || !this.visible || this.disposed,
      );
      if (done) this.refreshHighlights();
    } catch (cause) {
      if (generation === this.textGeneration) this.parts.onError?.(cause);
    }
  }

  private updateTextLayerViewport(): void {
    const width = this.surfaceWidth();
    if (width > 0) this.textLayer.setCssWidth(width, this.textPageWidth);
  }

  private onResize(): void {
    // The CSS scale of the text layer follows every frame of a pinch; the expensive parts wait.
    this.updateTextLayerViewport();
    if (!this.visible) return;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = undefined;
      this.requestRender();
      if (this.textLayer.ready) this.scheduleTextLayer();
    }, RESIZE_SETTLE_MS);
  }

  /** Paints the page's find matches onto its text layer (or clears them). */
  refreshHighlights(): void {
    const { pageIndex } = this.parts;
    const ranges = this.model.findHighlights().byPage.get(pageIndex);
    const pageText = this.model.pageText(pageIndex);
    if (!this.textLayer.ready || !ranges || ranges.length === 0 || !pageText) {
      this.model.highlights.clearPage(pageIndex);
      return;
    }
    this.model.highlights.setPage(
      pageIndex,
      buildPdfPageHighlight(this.textLayer, pageText, ranges),
    );
    this.model.notifyTextLayer(pageIndex);
  }

  private release(): void {
    const { pageIndex, canvasHost } = this.parts;
    this.model.highlights.clearPage(pageIndex);
    this.model.pageBudget.remove(pageIndex);
    this.textGeneration += 1;
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = undefined;
    this.textLayer.clear();
    this.textPageWidth = 0;
    if (this.canvas) {
      // Zero the backing store: removing the element alone may keep it until garbage collection.
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.canvas = undefined;
    }
    canvasHost.replaceChildren();
    this.renderedTarget = 0;
    const pdf = this.model.pdf();
    if (pdf) schedulePdfCleanup(pdf);
  }

  dispose(): void {
    this.disposed = true;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    if (this.textTimer) clearTimeout(this.textTimer);
    this.ticket?.cancel();
    this.ticket = undefined;
    this.release();
  }
}
