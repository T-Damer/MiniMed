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
        <div
          class="ocr-table__grid"
          role="table"
          style={{ '--ocr-table-columns': String(table().columns) }}
        >
          <For each={table().rows}>
            {(row) => (
              <div class="ocr-table__row" role="row">
                <For each={row}>
                  {(cell, index) => (
                    <span
                      class="ocr-table__cell"
                      classList={{
                        'ocr-table__cell--wide':
                          row.length === 1 ||
                          (index() === row.length - 1 && row.length < table().columns),
                      }}
                      role="cell"
                      style={
                        index() === row.length - 1 && row.length < table().columns
                          ? { 'grid-column-end': 'span ' + String(table().columns - index()) }
                          : undefined
                      }
                    >
                      {cell}
                    </span>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </HorizontalScroller>
    </figure>
  );
}
