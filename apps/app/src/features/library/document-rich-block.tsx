import { For, type JSX, Show } from 'solid-js';
import type { DocumentRenderBlock } from '@/features/library/document-rich-block-data';

export function DocumentRichBlock(props: { readonly block: DocumentRenderBlock }): JSX.Element {
  if (props.block.kind === 'image') {
    const caption = props.block.title || props.block.alt;
    return (
      <figure class="document-rich-image">
        <img src={props.block.dataUrl} alt={props.block.alt} loading="lazy" decoding="async" />
        <Show when={caption}>{(value) => <figcaption>{value()}</figcaption>}</Show>
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
                          <For each={cell.images}>
                            {(image) => (
                              <img
                                src={image.dataUrl}
                                alt={image.alt}
                                loading="lazy"
                                decoding="async"
                              />
                            )}
                          </For>
                        </td>
                      }
                    >
                      <th rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
                        {cell.text}
                        <For each={cell.images}>
                          {(image) => (
                            <img
                              src={image.dataUrl}
                              alt={image.alt}
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                        </For>
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
