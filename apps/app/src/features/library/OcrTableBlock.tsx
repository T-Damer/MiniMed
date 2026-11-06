import { For, type JSX } from 'solid-js';

import { HorizontalScroller } from '@/components/HorizontalScroller';
import { parseOcrTable } from '@/features/library/ocr-table';

import './ocr-table.css';

/** A table read from a scan whose rows could not be rebuilt: its lines as cells, marked as such. */
export function OcrTableBlock(props: { readonly text: string }): JSX.Element {
  const table = () => parseOcrTable(props.text);
  return (
    <figure class="ocr-table">
      <For each={table().caption}>
        {(line) => <figcaption class="ocr-table__caption">{line}</figcaption>}
      </For>
      <span class="ocr-table__badge">Таблица из скана</span>
      <HorizontalScroller class="ocr-table__scroller" controls controlLabel="таблицу">
        <table class="ocr-table__grid" style={{ '--ocr-table-columns': String(table().columns) }}>
          <tbody>
            <For each={table().rows}>
              {(row) => (
                <tr class="ocr-table__row">
                  <For each={row}>
                    {(cell, index) => {
                      // A short row's last cell takes the rest of the line.
                      const span = (): number =>
                        index() === row.length - 1 ? table().columns - index() : 1;
                      return (
                        <td
                          class="ocr-table__cell"
                          classList={{ 'ocr-table__cell--wide': row.length === 1 }}
                          colSpan={span()}
                        >
                          {cell}
                        </td>
                      );
                    }}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </HorizontalScroller>
    </figure>
  );
}
