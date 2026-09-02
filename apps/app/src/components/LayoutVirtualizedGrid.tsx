import { createMemo, createSignal, For, type JSX, onCleanup, onMount } from 'solid-js';
import { WindowVirtualizer } from 'virtua/solid';

import { chunkLayoutRows, type LayoutColumnCount, layoutColumnCount } from '@/state/layout-columns';

interface LayoutVirtualizedGridProps<T> {
  readonly data: readonly T[];
  readonly bufferSize?: number;
  readonly columns?: number;
  readonly maxColumns?: LayoutColumnCount;
  readonly minColumns?: LayoutColumnCount;
  readonly children: (item: T, index: number) => JSX.Element;
}

export function LayoutVirtualizedGrid<T>(props: LayoutVirtualizedGridProps<T>): JSX.Element {
  let container: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [viewportWidth, setViewportWidth] = createSignal(
    typeof window === 'undefined' ? 0 : window.innerWidth,
  );
  const responsiveColumns = createMemo(() =>
    layoutColumnCount(
      Math.max(containerWidth(), viewportWidth()),
      props.maxColumns ?? 2,
      props.minColumns ?? 1,
    ),
  );
  const columns = (): number => props.columns ?? responsiveColumns();
  const rows = createMemo(() => chunkLayoutRows(props.data, columns()));

  onMount(() => {
    if (props.columns !== undefined || !container) return;
    const syncWidth = (width: number): void => {
      setContainerWidth(width);
    };
    const syncViewport = (): void => {
      setViewportWidth(window.innerWidth);
    };
    syncWidth(container.getBoundingClientRect().width);
    syncViewport();
    window.addEventListener('resize', syncViewport);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) syncWidth(entry.contentRect.width);
    });
    observer.observe(container);
    onCleanup(() => {
      window.removeEventListener('resize', syncViewport);
      observer.disconnect();
    });
  });

  return (
    <div
      class="layout-virtualized-grid"
      ref={(element) => {
        container = element;
      }}
    >
      <WindowVirtualizer data={rows()} bufferSize={props.bufferSize ?? 400}>
        {(row, rowIndex) => (
          <div class="layout-card-row">
            <div
              class="layout-card-grid"
              style={{ '--layout-cols': String(Math.min(columns(), row.length)) }}
            >
              <For each={row}>
                {(item, columnIndex) =>
                  props.children(item, rowIndex() * columns() + columnIndex())
                }
              </For>
            </div>
            <div class="layout-card-row__gap" aria-hidden="true" />
          </div>
        )}
      </WindowVirtualizer>
    </div>
  );
}
