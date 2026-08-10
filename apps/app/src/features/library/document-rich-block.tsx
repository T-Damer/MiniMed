import { createSignal, For, type JSX, Show } from 'solid-js';
import type { DocumentRenderBlock } from '@/features/library/document-rich-block-data';

function ZoomableImage(props: {
  readonly image: { readonly dataUrl: string; readonly alt: string };
}): JSX.Element {
  const [zoomed, setZoomed] = createSignal(false);
  return (
    <button
      type="button"
      class={`document-rich-image__control${zoomed() ? ' document-rich-image__control--zoomed' : ''}`}
      aria-label={zoomed() ? 'Уменьшить изображение' : 'Увеличить изображение'}
      aria-pressed={zoomed()}
      onClick={() => setZoomed((open) => !open)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setZoomed(false);
        }
      }}
    >
      <img
        class={`document-rich-image__image${zoomed() ? ' document-rich-image__image--zoomed' : ''}`}
        src={props.image.dataUrl}
        alt={props.image.alt}
        loading="lazy"
        decoding="async"
      />
    </button>
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
  return (
    <section
      class="document-rich-table"
      aria-label={props.block.caption || 'Таблица из клинической рекомендации'}
    >
      <table>
        <Show when={props.block.caption}>{(caption) => <caption>{caption()}</caption>}</Show>
        <tbody>
          <For each={props.block.rows}>
            {(row) => (
              <tr>
                <For each={row.cells}>
                  {(cell) => (
                    <Show
                      when={cell.header}
                      fallback={
                        <td rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
                          {cell.text}
                          <For each={cell.images}>{(image) => <ZoomableImage image={image} />}</For>
                        </td>
                      }
                    >
                      <th rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
                        {cell.text}
                        <For each={cell.images}>{(image) => <ZoomableImage image={image} />}</For>
                      </th>
                    </Show>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </section>
  );
}
