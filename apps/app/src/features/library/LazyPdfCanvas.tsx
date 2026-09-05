import { TextLayer } from 'pdfjs-dist';
import { createEffect, type JSX, onCleanup, onMount } from 'solid-js';

import type { PdfDocumentProxy, PdfPageProxy } from '@/state/pdfjs-document';

const PDF_RENDER_OVERSAMPLE = 1.25;
const PDF_MAX_CANVAS_PIXELS = 2_500_000;
const PDF_PAGE_RELEASE_DELAY_MS = 1_200;
const PDF_CLEANUP_DELAY_MS = 250;

const pdfCleanupTimers = new WeakMap<PdfDocumentProxy, ReturnType<typeof setTimeout>>();

function schedulePdfCleanup(pdf: PdfDocumentProxy): void {
  const currentTimer = pdfCleanupTimers.get(pdf);
  if (currentTimer) clearTimeout(currentTimer);
  const timer = setTimeout(() => {
    pdfCleanupTimers.delete(pdf);
    void pdf.cleanup().catch((cause: unknown) => {
      if (!(cause instanceof Error) || !cause.message.includes('currently rendering')) {
        console.warn('PDF cleanup failed.', cause);
      }
    });
  }, PDF_CLEANUP_DELAY_MS);
  pdfCleanupTimers.set(pdf, timer);
}

interface LazyPdfCanvasProps {
  readonly id: string;
  readonly pageNumber: number;
  readonly pdf: () => PdfDocumentProxy | null;
  readonly class?: string;
  readonly onError?: (cause: unknown) => void;
}

export function LazyPdfCanvas(props: LazyPdfCanvasProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let pageSurface: HTMLDivElement | undefined;
  let textLayerHost: HTMLDivElement | undefined;
  let visible = false;
  let rendered = false;
  let generation = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;
  let surfaceResizeObserver: ResizeObserver | undefined;
  let textLayer: TextLayer | undefined;
  let textLayerPage: PdfPageProxy | undefined;
  let textLayerPageWidth = 0;
  let renderedSurfaceWidth = 0;
  let renderTask: ReturnType<PdfPageProxy['render']> | undefined;

  const clearTextLayer = (): void => {
    textLayer?.cancel();
    textLayer = undefined;
    textLayerPage = undefined;
    textLayerPageWidth = 0;
    textLayerHost?.replaceChildren();
  };

  const updateTextLayerViewport = (): void => {
    if (!textLayer || !textLayerPage || !textLayerHost || textLayerPageWidth <= 0) return;
    const width = pageSurface?.clientWidth ?? 0;
    if (width <= 0) return;
    const viewport = textLayerPage.getViewport({ scale: width / textLayerPageWidth });
    textLayerHost.style.setProperty('--total-scale-factor', String(viewport.scale));
    textLayerHost.style.width = '100%';
    textLayerHost.style.height = '100%';
    textLayer.update({ viewport });
  };

  const clearCanvas = (): void => {
    if (!canvas) return;
    renderTask?.cancel();
    renderTask = undefined;
    generation += 1;
    rendered = false;
    renderedSurfaceWidth = 0;
    clearTextLayer();
    canvas.width = 1;
    canvas.height = 1;
  };

  const scheduleRelease = (): void => {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      if (!visible) {
        clearCanvas();
        const pdf = props.pdf();
        if (pdf) schedulePdfCleanup(pdf);
      }
    }, PDF_PAGE_RELEASE_DELAY_MS);
  };

  const renderPage = async (): Promise<void> => {
    if (!canvas || !visible || rendered) return;
    const pdf = props.pdf();
    if (!pdf) return;
    const run = ++generation;
    try {
      const page = await pdf.getPage(props.pageNumber);
      try {
        if (run !== generation || !visible || !canvas) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const displayScale =
          ((pageSurface?.clientWidth || baseViewport.width) / baseViewport.width) *
          PDF_RENDER_OVERSAMPLE;
        const pixelScale = Math.sqrt(
          PDF_MAX_CANVAS_PIXELS / (baseViewport.width * baseViewport.height),
        );
        const viewport = page.getViewport({
          scale: Math.min(displayScale, pixelScale),
        });
        const textContentPromise = page.getTextContent();
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        renderedSurfaceWidth = pageSurface?.clientWidth ?? 0;
        const nextRenderTask = page.render({ canvasContext: context, viewport, canvas });
        renderTask = nextRenderTask;
        try {
          await nextRenderTask.promise;
        } finally {
          if (renderTask === nextRenderTask) renderTask = undefined;
        }
        if (run !== generation) return;
        if (!visible) {
          clearCanvas();
          schedulePdfCleanup(pdf);
          return;
        }
        rendered = true;
        const textContent = await textContentPromise;
        if (run !== generation || !visible || !textLayerHost) return;
        clearTextLayer();
        textLayerHost.style.setProperty('--total-scale-factor', String(viewport.scale));
        const nextTextLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerHost,
          viewport,
        });
        await nextTextLayer.render();
        if (run !== generation || !visible || !textLayerHost) {
          nextTextLayer.cancel();
          return;
        }
        for (const textDiv of nextTextLayer.textDivs) {
          textDiv.classList.add('user-document-reader__pdf-text-run');
        }
        textLayer = nextTextLayer;
        textLayerPage = page;
        textLayerPageWidth = page.getViewport({ scale: 1 }).width;
        updateTextLayerViewport();
      } finally {
        page.cleanup();
      }
    } catch (cause) {
      if (run === generation) props.onError?.(cause);
    }
  };

  onMount(() => {
    if (!canvas) return;
    surfaceResizeObserver = new ResizeObserver(() => {
      updateTextLayerViewport();
      const width = pageSurface?.clientWidth ?? 0;
      if (visible && rendered && width > renderedSurfaceWidth + 1) {
        clearCanvas();
        void renderPage();
      }
    });
    if (pageSurface) surfaceResizeObserver.observe(pageSurface);
    const touchDevice =
      navigator.maxTouchPoints > 0 ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
    observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        visible = Boolean(entry?.isIntersecting);
        if (visible) {
          if (releaseTimer) {
            clearTimeout(releaseTimer);
            releaseTimer = undefined;
          }
          void renderPage();
        } else {
          if (renderTask) {
            clearCanvas();
            const pdf = props.pdf();
            if (pdf) schedulePdfCleanup(pdf);
          } else if (rendered) {
            scheduleRelease();
          }
        }
      },
      { rootMargin: touchDevice ? '250px 0px' : '900px 0px' },
    );
    observer.observe(canvas);
  });

  createEffect(() => {
    props.pdf();
    if (visible) void renderPage();
  });

  onCleanup(() => {
    observer?.disconnect();
    surfaceResizeObserver?.disconnect();
    if (releaseTimer) clearTimeout(releaseTimer);
    clearCanvas();
  });

  return (
    <div ref={pageSurface} class="user-document-reader__pdf-page">
      <canvas ref={canvas} id={props.id} class={props.class} />
      <div ref={textLayerHost} class="user-document-reader__pdf-text-layer" />
    </div>
  );
}
