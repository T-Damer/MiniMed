import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { PdfPage } from '@/features/pdf-viewer/PdfPage';
import { PdfThumbnails } from '@/features/pdf-viewer/PdfThumbnails';
import type { PdfViewerModel } from '@/features/pdf-viewer/pdf-viewer-model';
import { formatPdfZoom } from '@/features/pdf-viewer/pdf-zoom';
import '@/styles/pdf-viewer.css';

export interface PdfViewerProps {
  readonly model: PdfViewerModel;
  /** Two pages side by side. */
  readonly twoPage?: boolean;
  /** DOM id of a page box (anchors for outlines and the scroll-spy). */
  readonly pageId?: (pageIndex: number) => string;
  readonly canvasId?: (pageIndex: number) => string;
  readonly anchorAttribute?: string;
  readonly onPageError?: (cause: unknown) => void;
  /** Layers over a page (OCR words). */
  readonly pageOverlay?: (pageIndex: number) => JSX.Element;
  /** `rail` shows the thumbnails next to the pages; the host may show them elsewhere instead. */
  readonly thumbnailRail?: boolean;
  readonly thumbnailsOpen?: boolean;
  /** A thumbnail was chosen (a phone closes the floating strip here). */
  readonly onThumbnailSelected?: () => void;
  /** Page box and zoom buttons over the pages. */
  readonly dock?: boolean;
  /** The viewer fills a box of its own and scrolls inside it (a dialog) instead of the window. */
  readonly contained?: boolean;
  readonly class?: string;
}

function PdfDock(props: {
  readonly model: PdfViewerModel;
  readonly aboveNav: boolean;
}): JSX.Element {
  const [draft, setDraft] = createSignal<string | undefined>(undefined);
  const model = props.model;
  const commit = (value: string): void => {
    const page = Number.parseInt(value, 10);
    setDraft(undefined);
    if (Number.isFinite(page)) model.goToPage(page);
  };
  const fitLabel = (): string => (model.fit() === 'width' ? 'Вся страница' : 'По ширине');

  return (
    <div
      class="pdf-viewer__dock"
      classList={{ 'pdf-viewer__dock--above-nav': props.aboveNav }}
      role="toolbar"
      aria-label="Страницы и масштаб"
    >
      <button
        type="button"
        class="pdf-viewer__dock-button"
        aria-label="Предыдущая страница"
        disabled={model.currentPage() <= 1}
        onClick={() => model.stepPage(-1)}
      >
        <AppGlyph name="caret-up" class="pdf-viewer__dock-icon" />
      </button>
      <label class="pdf-viewer__page-box">
        <span class="visually-hidden">Номер страницы</span>
        <input
          class="pdf-viewer__page-input"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          value={draft() ?? String(model.currentPage())}
          style={{ width: `${String(Math.max(2, String(model.pageCount()).length) + 0.5)}ch` }}
          onFocus={(event) => event.currentTarget.select()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(undefined);
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            if (draft() !== undefined) commit(event.currentTarget.value);
          }}
        />
        <span class="pdf-viewer__page-total">/ {model.pageCount()}</span>
      </label>
      <button
        type="button"
        class="pdf-viewer__dock-button"
        aria-label="Следующая страница"
        disabled={model.currentPage() >= model.pageCount()}
        onClick={() => model.stepPage(1)}
      >
        <AppGlyph name="caret-down" class="pdf-viewer__dock-icon" />
      </button>
      <span class="pdf-viewer__dock-divider" aria-hidden="true" />
      <button
        type="button"
        class="pdf-viewer__dock-button"
        aria-label="Уменьшить"
        title="Уменьшить"
        onClick={model.zoomOut}
      >
        <AppGlyph name="minus" class="pdf-viewer__dock-icon" />
      </button>
      <button
        type="button"
        class="pdf-viewer__dock-value"
        aria-label={`Масштаб ${formatPdfZoom(model.zoom())}. ${fitLabel()}`}
        title={fitLabel()}
        onClick={() => (model.fit() === 'width' ? model.fitPage() : model.fitWidth())}
      >
        {formatPdfZoom(model.zoom())}
      </button>
      <button
        type="button"
        class="pdf-viewer__dock-button"
        aria-label="Увеличить"
        title="Увеличить"
        onClick={model.zoomIn}
      >
        <AppGlyph name="plus" class="pdf-viewer__dock-icon" />
      </button>
    </div>
  );
}

/**
 * The one PDF reader of the app: lazily drawn pages with a selectable text layer, find highlights,
 * zoom (buttons, pinch, Ctrl/⌘+wheel, fit width/page), a page box, thumbnails and a remembered
 * reading position. The logic is in `PdfViewerModel`; hosts bring the file and the chrome.
 */
export function PdfViewer(props: PdfViewerProps): JSX.Element {
  const model = props.model;
  const pages = (): readonly number[] =>
    Array.from({ length: model.pageCount() }, (_, index) => index);
  let pagesRoot: HTMLDivElement | undefined;
  let columns: HTMLDivElement | undefined;
  onMount(() => model.setRoot(pagesRoot, columns));
  onCleanup(() => model.setRoot(undefined, undefined));

  return (
    <div
      class={`pdf-viewer${props.contained ? ' pdf-viewer--contained' : ''}${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'pdf-viewer--rail-open': Boolean(props.thumbnailRail && props.thumbnailsOpen) }}
      style={{ '--pdf-zoom': String(model.zoom()) }}
    >
      <Show when={props.thumbnailRail && props.thumbnailsOpen}>
        <aside class="pdf-viewer__rail" aria-label="Миниатюры страниц">
          <PdfThumbnails
            model={model}
            column
            {...(props.onThumbnailSelected ? { onSelected: props.onThumbnailSelected } : {})}
          />
        </aside>
      </Show>
      <div
        class="pdf-viewer__main"
        classList={{ 'pdf-viewer__main--scrolling': props.contained === true }}
        data-pdf-scroller={props.contained ? '' : undefined}
      >
        <div ref={columns} class="pdf-viewer__columns">
          <div
            ref={pagesRoot}
            class="pdf-viewer__pages"
            classList={{ 'pdf-viewer__pages--two': props.twoPage === true }}
          >
            <For each={pages()}>
              {(pageIndex) => (
                <PdfPage
                  model={model}
                  pageIndex={pageIndex}
                  {...(props.pageId ? { id: props.pageId(pageIndex) } : {})}
                  {...(props.canvasId ? { canvasId: props.canvasId(pageIndex) } : {})}
                  {...(props.anchorAttribute ? { anchorAttribute: props.anchorAttribute } : {})}
                  {...(props.onPageError ? { onError: props.onPageError } : {})}
                >
                  {props.pageOverlay?.(pageIndex)}
                </PdfPage>
              )}
            </For>
          </div>
        </div>
        <Show when={props.dock !== false && model.pageCount() > 0}>
          <PdfDock model={model} aboveNav={props.contained !== true} />
        </Show>
      </div>
    </div>
  );
}
