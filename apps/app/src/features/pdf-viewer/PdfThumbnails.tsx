import { createEffect, For, type JSX, on, onCleanup, onMount } from 'solid-js';
import { findPdfScroller } from '@/features/pdf-viewer/pdf-scroller';
import { PdfThumbnailRenderer } from '@/features/pdf-viewer/pdf-thumbnail-renderer';
import type { PdfViewerModel } from '@/features/pdf-viewer/pdf-viewer-model';

function PdfThumbnail(props: {
  readonly model: PdfViewerModel;
  readonly pageIndex: number;
  readonly onSelect: (pageNumber: number) => void;
}): JSX.Element {
  let frame: HTMLSpanElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let renderer: PdfThumbnailRenderer | undefined;
  const number = (): number => props.pageIndex + 1;
  const active = (): boolean => props.model.currentPage() === number();

  onMount(() => {
    if (!frame || !canvas) return;
    renderer = new PdfThumbnailRenderer({
      model: props.model,
      pageIndex: props.pageIndex,
      frame,
      canvas,
    });
  });
  createEffect(
    on(
      () => props.model.pdf(),
      () => renderer?.documentChanged(),
      { defer: true },
    ),
  );
  onCleanup(() => renderer?.dispose());

  return (
    <li class="pdf-thumbnails__cell">
      <button
        type="button"
        class="pdf-thumbnails__item"
        classList={{ 'pdf-thumbnails__item--active': active() }}
        data-pdf-thumbnail={props.pageIndex}
        aria-label={`Страница ${String(number())}`}
        aria-current={active() ? 'page' : undefined}
        onClick={() => props.onSelect(number())}
      >
        <span
          ref={frame}
          class="pdf-thumbnails__frame"
          style={{ 'aspect-ratio': String(props.model.aspect(props.pageIndex)) }}
        >
          <canvas ref={canvas} class="pdf-thumbnails__canvas" width={1} height={1} />
        </span>
        <span class="pdf-thumbnails__label">{number()}</span>
      </button>
    </li>
  );
}

/** Page strip: a small picture of every page, the current one marked, a tap goes to the page. */
export function PdfThumbnails(props: {
  readonly model: PdfViewerModel;
  /** Called after a page was chosen (a phone drawer closes itself here). */
  readonly onSelected?: () => void;
  /** One thumbnail per row (a narrow rail) instead of a grid. */
  readonly column?: boolean;
}): JSX.Element {
  let list: HTMLUListElement | undefined;
  const pages = (): readonly number[] =>
    Array.from({ length: props.model.pageCount() }, (_, index) => index);

  // Keep the current page's thumbnail in view inside its own scroller (never the page's).
  createEffect(() => {
    const page = props.model.currentPage();
    queueMicrotask(() => {
      const item = list?.querySelector<HTMLElement>(`[data-pdf-thumbnail="${String(page - 1)}"]`);
      if (!item || !list) return;
      const scroller = findPdfScroller(list);
      const element = scroller.element;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const rect = item.getBoundingClientRect();
      if (rect.top < box.top || rect.bottom > box.bottom) {
        element.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
      }
    });
  });

  return (
    <ul
      ref={list}
      class="pdf-thumbnails"
      classList={{ 'pdf-thumbnails--column': props.column === true }}
      aria-label="Страницы документа"
    >
      <For each={pages()}>
        {(pageIndex) => (
          <PdfThumbnail
            model={props.model}
            pageIndex={pageIndex}
            onSelect={(page) => {
              props.model.goToPage(page);
              props.onSelected?.();
            }}
          />
        )}
      </For>
    </ul>
  );
}
