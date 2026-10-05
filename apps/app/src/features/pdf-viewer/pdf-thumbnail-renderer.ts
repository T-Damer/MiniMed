import { schedulePdfCleanup } from '@/features/pdf-viewer/pdf-page-renderer';
import type { PdfRenderTicket } from '@/features/pdf-viewer/pdf-render-queue';
import type { PdfViewerModel } from '@/features/pdf-viewer/pdf-viewer-model';

/** Thumbnails never run ahead of a page that is waiting to be drawn. */
const THUMBNAIL_PRIORITY_BASE = 1_000_000;
export const PDF_THUMBNAIL_WIDTH_CSS_PX = 104;

export interface PdfThumbnailParts {
  readonly model: PdfViewerModel;
  readonly pageIndex: number;
  readonly frame: HTMLElement;
  readonly canvas: HTMLCanvasElement;
}

/** Draws one page thumbnail while it is on screen and hands its memory back to the shared budget. */
export class PdfThumbnailRenderer {
  private readonly parts: PdfThumbnailParts;
  private ticket: PdfRenderTicket | undefined;
  private drawn = false;
  private visible = false;
  private observer: IntersectionObserver | undefined;
  private disposed = false;

  constructor(parts: PdfThumbnailParts) {
    this.parts = parts;
    this.observer = new IntersectionObserver(
      (entries) => this.setVisible(Boolean(entries.at(-1)?.isIntersecting)),
      { rootMargin: '160px 0px' },
    );
    this.observer.observe(parts.frame);
  }

  private setVisible(next: boolean): void {
    if (this.disposed || next === this.visible) return;
    this.visible = next;
    const { model, pageIndex } = this.parts;
    model.thumbnailBudget.setVisible(pageIndex, next);
    if (next) {
      this.request();
    } else {
      this.ticket?.cancel();
      this.ticket = undefined;
    }
  }

  /** The document changed. */
  documentChanged(): void {
    this.ticket?.cancel();
    this.ticket = undefined;
    this.clear();
    if (this.visible) this.request();
  }

  private request(): void {
    const { model, pageIndex } = this.parts;
    if (this.disposed || !this.visible || this.drawn || this.ticket || !model.pdf()) return;
    this.ticket = model.queue.enqueue({
      priority: () => THUMBNAIL_PRIORITY_BASE + Math.abs(pageIndex + 1 - model.currentPage()),
      run: (signal) => this.draw(signal),
    });
  }

  private async draw(signal: AbortSignal): Promise<void> {
    const { model, pageIndex, canvas } = this.parts;
    const pdf = model.pdf();
    if (!pdf) return;
    const page = await pdf.getPage(pageIndex + 1);
    try {
      if (signal.aborted || !this.visible) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const scale = (PDF_THUMBNAIL_WIDTH_CSS_PX * ratio) / base.width;
      const viewport = page.getViewport({ scale });
      // Draw on a scratch canvas so a cancelled render never leaves half a page on screen.
      const scratch = document.createElement('canvas');
      scratch.width = Math.max(1, Math.floor(viewport.width));
      scratch.height = Math.max(1, Math.floor(viewport.height));
      const context = scratch.getContext('2d');
      if (!context) return;
      const task = page.render({ canvasContext: context, viewport, canvas: scratch });
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
      if (signal.aborted || this.disposed) {
        scratch.width = 1;
        scratch.height = 1;
        return;
      }
      canvas.width = scratch.width;
      canvas.height = scratch.height;
      canvas.getContext('2d')?.drawImage(scratch, 0, 0);
      scratch.width = 1;
      scratch.height = 1;
      this.drawn = true;
      model.thumbnailBudget.add(pageIndex, {
        bytes: canvas.width * canvas.height * 4,
        release: () => this.clear(),
      });
    } finally {
      page.cleanup();
      this.ticket = undefined;
      // Pages read only for a thumbnail leave parsed fonts and operator lists behind.
      schedulePdfCleanup(pdf);
    }
  }

  private clear(): void {
    const { canvas } = this.parts;
    canvas.width = 1;
    canvas.height = 1;
    this.drawn = false;
    // A thumbnail released while still near the screen draws again when it is requested.
    if (this.visible && !this.disposed) queueMicrotask(() => this.request());
  }

  dispose(): void {
    this.disposed = true;
    this.observer?.disconnect();
    this.ticket?.cancel();
    this.ticket = undefined;
    this.parts.model.thumbnailBudget.remove(this.parts.pageIndex);
    this.parts.canvas.width = 1;
    this.parts.canvas.height = 1;
  }
}
