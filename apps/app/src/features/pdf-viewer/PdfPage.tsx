import { createEffect, type JSX, on, onCleanup, onMount } from 'solid-js';

import { PdfPageRenderer } from '@/features/pdf-viewer/pdf-page-renderer';
import type { PdfViewerModel } from '@/features/pdf-viewer/pdf-viewer-model';

export interface PdfPageProps {
  readonly model: PdfViewerModel;
  /** 0-based. */
  readonly pageIndex: number;
  /** DOM id of the page box, so outlines and links can scroll to it. */
  readonly id?: string;
  readonly canvasId?: string;
  /** Marks the page for a reader's scroll-spy (`data-user-doc-anchor`, …). */
  readonly anchorAttribute?: string;
  readonly onError?: (cause: unknown) => void;
  /** Layers positioned over the page (OCR words, annotations). */
  readonly children?: JSX.Element;
}

export function PdfPage(props: PdfPageProps): JSX.Element {
  let surface: HTMLDivElement | undefined;
  let canvasHost: HTMLDivElement | undefined;
  let textHost: HTMLDivElement | undefined;
  let renderer: PdfPageRenderer | undefined;

  onMount(() => {
    if (!surface || !canvasHost || !textHost) return;
    renderer = new PdfPageRenderer({
      model: props.model,
      pageIndex: props.pageIndex,
      surface,
      canvasHost,
      textHost,
      canvasId: props.canvasId,
      onError: props.onError,
    });
  });

  createEffect(
    on(
      () => props.model.pdf(),
      () => renderer?.documentChanged(),
      { defer: true },
    ),
  );
  createEffect(() => {
    props.model.findHighlights();
    renderer?.refreshHighlights();
  });
  onCleanup(() => renderer?.dispose());

  const anchor = (): Record<string, string> =>
    props.anchorAttribute ? { [props.anchorAttribute]: '' } : {};

  return (
    <div
      ref={surface}
      id={props.id}
      class="pdf-viewer__page"
      data-pdf-page={props.pageIndex}
      style={{ 'aspect-ratio': String(props.model.aspect(props.pageIndex)) }}
      {...anchor()}
    >
      <div ref={canvasHost} class="pdf-viewer__canvas-host" />
      <div ref={textHost} class="pdf-viewer__text-layer" />
      {props.children}
    </div>
  );
}
