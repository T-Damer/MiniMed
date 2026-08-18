import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { printHtml } from '@/features/library/document-print';
import type {
  DocumentRenderBlock,
  DocumentTableBlock,
  DocumentTableRow,
} from '@/features/library/document-rich-block-data';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function printableMediaPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 1rem; font-family: system-ui, -apple-system, sans-serif; color: #292720; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #cbc0a7; padding: 0.5rem 0.625rem; text-align: left; vertical-align: top; background: #fff; }
    th { font-weight: 600; }
    img { display: block; max-width: 100%; height: auto; background: #fff; }
    figcaption { margin-top: 0.5rem; font-size: 0.875rem; color: #585349; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

function renderTableMarkup(block: DocumentTableBlock, tableClass: string): string {
  const rows = block.rows
    .map((row: DocumentTableRow) => {
      const cells = row.cells
        .map((cell) => {
          const tag = cell.header ? 'th' : 'td';
          const rowSpan = cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '';
          const colSpan = cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
          return `<${tag}${rowSpan}${colSpan}>${escapeHtml(cell.text)}</${tag}>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : '';
  return `<table class="${tableClass}">${caption}<tbody>${rows}</tbody></table>`;
}

function buildTablePrintHtml(block: DocumentTableBlock): string {
  const title = block.caption || 'Таблица';
  return printableMediaPage(title, renderTableMarkup(block, 'media-print__table'));
}

function buildImagePrintHtml(image: {
  readonly dataUrl: string;
  readonly alt: string;
  readonly title?: string;
}): string {
  const caption = image.title || image.alt;
  const figure = `<figure><img src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(image.alt)}" />${
    caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
  }</figure>`;
  return printableMediaPage(caption || 'Изображение', figure);
}

function MediaViewer(props: {
  readonly open: boolean;
  readonly title: string;
  readonly printHtmlContent: string;
  readonly onClose: () => void;
  readonly children: JSX.Element;
}): JSX.Element {
  createEffect(() => {
    if (!props.open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      props.onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown, true));
  });

  const handlePrint = (): void => {
    if (!printHtml(props.printHtmlContent, props.title)) {
      toast.error('Не удалось открыть окно печати.');
    }
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div class="media-viewer" role="dialog" aria-modal="true" aria-label={props.title}>
          <button
            type="button"
            class="media-viewer__backdrop"
            aria-label="Закрыть просмотр"
            onClick={props.onClose}
          />
          <div class="media-viewer__panel">
            <header class="media-viewer__toolbar">
              <button
                type="button"
                class="media-viewer__toolbar-button"
                aria-label="Печать"
                title="Печать"
                onClick={handlePrint}
              >
                <AppGlyph name="printer" class="media-viewer__toolbar-icon" />
              </button>
              <button
                type="button"
                class="media-viewer__toolbar-button"
                aria-label="Закрыть"
                title="Закрыть"
                onClick={props.onClose}
              >
                <AppGlyph name="close" class="media-viewer__toolbar-icon" />
              </button>
            </header>
            <div class="media-viewer__content">{props.children}</div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

function RichTableMarkup(props: {
  readonly block: DocumentTableBlock;
  readonly tableClass: string;
}): JSX.Element {
  return (
    <table class={props.tableClass}>
      <Show when={props.block.caption}>{(caption) => <caption>{caption()}</caption>}</Show>
      <tbody>
        <For each={props.block.rows}>
          {(row: DocumentTableRow) => (
            <tr>
              <For each={row.cells}>
                {(cell) => (
                  <Show
                    when={cell.header}
                    fallback={
                      <td rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
                        {cell.text}
                      </td>
                    }
                  >
                    <th rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
                      {cell.text}
                    </th>
                  </Show>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

function ZoomableImage(props: {
  readonly image: { readonly dataUrl: string; readonly alt: string; readonly title?: string };
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button
        type="button"
        class="document-rich-image__control"
        aria-label="Открыть изображение"
        onClick={() => setOpen(true)}
      >
        <img
          class="document-rich-image__image"
          src={props.image.dataUrl}
          alt={props.image.alt}
          loading="lazy"
          decoding="async"
        />
      </button>
      <MediaViewer
        open={open()}
        title={props.image.title || props.image.alt || 'Изображение'}
        printHtmlContent={buildImagePrintHtml(props.image)}
        onClose={() => setOpen(false)}
      >
        <figure class="media-viewer__figure">
          <img
            class="media-viewer__image"
            src={props.image.dataUrl}
            alt={props.image.alt}
            decoding="async"
          />
          <Show when={props.image.title || props.image.alt}>
            {(caption) => <figcaption class="media-viewer__caption">{caption()}</figcaption>}
          </Show>
        </figure>
      </MediaViewer>
    </>
  );
}

function ZoomableTable(props: { readonly block: DocumentTableBlock }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const title = () => props.block.caption || 'Таблица из клинической рекомендации';

  return (
    <section class="document-rich-table" aria-label={title()}>
      <div class="document-rich-table__toolbar">
        <button
          type="button"
          class="document-rich-table__zoom"
          aria-label="Открыть таблицу на весь экран"
          title="Открыть таблицу на весь экран"
          onClick={() => setOpen(true)}
        >
          <AppGlyph name="arrows-out" class="document-rich-table__zoom-icon" />
        </button>
      </div>
      <div class="document-rich-table__scroller">
        <RichTableMarkup block={props.block} tableClass="document-rich-table__table" />
      </div>
      <MediaViewer
        open={open()}
        title={title()}
        printHtmlContent={buildTablePrintHtml(props.block)}
        onClose={() => setOpen(false)}
      >
        <div class="media-viewer__table-wrap">
          <RichTableMarkup block={props.block} tableClass="media-viewer__table" />
        </div>
      </MediaViewer>
    </section>
  );
}

export function DocumentRichBlock(props: { readonly block: DocumentRenderBlock }): JSX.Element {
  if (props.block.kind === 'image') {
    const caption = props.block.title || props.block.alt;
    return (
      <figure class="document-rich-image">
        <ZoomableImage image={props.block} />
        <Show when={caption}>
          {(value) => <figcaption class="document-rich-image__caption">{value()}</figcaption>}
        </Show>
      </figure>
    );
  }
  return <ZoomableTable block={props.block} />;
}
