import { createEffect, type JSX, onCleanup, onMount } from 'solid-js';

import type { PdfDocumentProxy } from '@/state/pdfjs-document';

interface LazyPdfCanvasProps {
  readonly id: string;
  readonly pageNumber: number;
  readonly pdf: () => PdfDocumentProxy | null;
  readonly class?: string;
  readonly onError?: (cause: unknown) => void;
}

export function LazyPdfCanvas(props: LazyPdfCanvasProps): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let visible = false;
  let rendered = false;
  let generation = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;

  const clearCanvas = (): void => {
    if (!canvas) return;
    generation += 1;
    rendered = false;
    canvas.width = 1;
    canvas.height = 1;
  };

  const scheduleRelease = (): void => {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      if (!visible) clearCanvas();
    }, 8_000);
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
        const viewport = page.getViewport({ scale: 1.25 });
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        if (run === generation) rendered = true;
      } finally {
        page.cleanup();
      }
    } catch (cause) {
      if (run === generation) props.onError?.(cause);
    }
  };

  onMount(() => {
    if (!canvas) return;
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
        } else if (rendered) {
          scheduleRelease();
        }
      },
      { rootMargin: '900px 0px' },
    );
    observer.observe(canvas);
  });

  createEffect(() => {
    props.pdf();
    if (visible) void renderPage();
  });

  onCleanup(() => {
    generation += 1;
    observer?.disconnect();
    if (releaseTimer) clearTimeout(releaseTimer);
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  });

  return <canvas ref={canvas} id={props.id} class={props.class} />;
}
