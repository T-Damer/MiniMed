import { createMemo, For, type JSX } from 'solid-js';
import { WindowVirtualizer } from 'virtua/solid';

import { chunkLayoutRows, createLayoutColumnCount } from '@/state/layout-columns';

interface LayoutVirtualizedGridProps<T> {
  readonly data: readonly T[];
  readonly bufferSize?: number;
  readonly children: (item: T, index: number) => JSX.Element;
}

export function LayoutVirtualizedGrid<T>(props: LayoutVirtualizedGridProps<T>): JSX.Element {
  const columns = createLayoutColumnCount();
  const rows = createMemo(() => chunkLayoutRows(props.data, columns()));

  return (
    <WindowVirtualizer data={rows()} bufferSize={props.bufferSize ?? 400}>
      {(row, rowIndex) => (
        <div class="layout-card-row">
          <div class="layout-card-grid">
            <For each={row}>
              {(item, columnIndex) => props.children(item, rowIndex() * columns() + columnIndex())}
            </For>
          </div>
          <div class="layout-card-row__gap" aria-hidden="true" />
        </div>
      )}
    </WindowVirtualizer>
  );
}
