import {
  createComputed,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  For,
  getOwner,
  type JSX,
  on,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import { WindowVirtualizer } from 'virtua/solid';

import { RetainedNodeCache } from '@/components/retained-node-cache';
import { chunkLayoutRows, type LayoutColumnCount, layoutColumnCount } from '@/state/layout-columns';

interface LayoutVirtualizedGridProps<T> {
  readonly data: readonly T[];
  readonly bufferSize?: number;
  /** Expected row height; a close estimate stops rows from jumping as they are first measured. */
  readonly rowSize?: number;
  readonly columns?: number;
  readonly maxColumns?: LayoutColumnCount;
  readonly minColumns?: LayoutColumnCount;
  /**
   * Keep each item's DOM node for as long as the item (by reference) stays in `data`, also when an
   * insertion or a new order moves it into another row, and give keyboard focus back to it after
   * such a move. Items must keep their identity across updates. `index` is then the item's index
   * when it was first rendered.
   */
  readonly preserveItemNodes?: boolean;
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
  // Rows keep their identity while their items do, so the virtualizer reuses their DOM.
  const rows = createMemo<readonly (readonly T[])[]>((previous) =>
    chunkLayoutRows(props.data, columns(), previous),
  );

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

  const row = (cells: () => JSX.Element, count: () => number): JSX.Element => (
    <div class="layout-card-row">
      <div
        class="layout-card-grid"
        style={{ '--layout-cols': String(Math.min(columns(), count())) }}
      >
        {cells()}
      </div>
      <div class="layout-card-row__gap" aria-hidden="true" />
    </div>
  );

  return (
    <div
      class="layout-virtualized-grid"
      ref={(element) => {
        container = element;
      }}
    >
      {props.preserveItemNodes ? (
        <RetainedRows rows={rows} container={() => container} render={props.children} row={row} />
      ) : (
        <WindowVirtualizer
          data={rows()}
          bufferSize={props.bufferSize ?? 400}
          itemSize={props.rowSize ?? 160}
        >
          {(items, rowIndex) =>
            row(
              () => (
                <For each={items}>
                  {(item, columnIndex) =>
                    props.children(item, rowIndex() * columns() + columnIndex())
                  }
                </For>
              ),
              () => items.length,
            )
          }
        </WindowVirtualizer>
      )}
    </div>
  );

  function RetainedRows(retained: {
    readonly rows: () => readonly (readonly T[])[];
    readonly container: () => HTMLDivElement | undefined;
    readonly render: (item: T, index: number) => JSX.Element;
    readonly row: (cells: () => JSX.Element, count: () => number) => JSX.Element;
  }): JSX.Element {
    // One slot per row position: the virtualizer keys rows by reference, so an insertion that
    // changes every row's contents still keeps every row element.
    const slots: { readonly index: number }[] = [];
    const slotRows = createMemo(() => {
      const count = retained.rows().length;
      for (let index = slots.length; index < count; index += 1) slots.push({ index });
      return slots.slice(0, count);
    });
    const itemsOf = (slot: { readonly index: number }): readonly T[] =>
      retained.rows()[slot.index] ?? [];

    // Each item renders once into its own `display: contents` holder; a row's cell only hosts it,
    // so moving the item into another row moves the holder instead of rebuilding the item.
    const owner = getOwner();
    const nodes = new RetainedNodeCache<T, HTMLElement>((item) =>
      createRoot((dispose) => {
        // Rendered once, untracked: a later `data` change must not rebuild the item.
        const content = untrack(() => retained.render(item, props.data.indexOf(item)));
        const holder = (<div class="layout-card-grid__item">{content}</div>) as HTMLElement;
        return { value: holder, dispose };
      }, owner),
    );
    onCleanup(() => nodes.clear());

    // Moving a focused node blurs it; give focus back once the rows have been rebuilt, but only
    // when it fell to the page (never take it from where the user moved it).
    let focusedBeforeUpdate: HTMLElement | null = null;
    createComputed(
      on(retained.rows, () => {
        const active = document.activeElement;
        const host = retained.container();
        focusedBeforeUpdate =
          active instanceof HTMLElement && host?.contains(active) ? active : null;
      }),
    );
    createEffect(
      on(retained.rows, () => {
        const target = focusedBeforeUpdate;
        focusedBeforeUpdate = null;
        const active = document.activeElement;
        if (!target?.isConnected || active === target) return;
        if (active && active !== document.body) return;
        target.focus({ preventScroll: true });
      }),
    );

    return (
      <WindowVirtualizer
        data={slotRows()}
        bufferSize={props.bufferSize ?? 400}
        itemSize={props.rowSize ?? 160}
      >
        {(slot) =>
          retained.row(
            () => (
              <For each={itemsOf(slot)}>
                {(item) => {
                  const holder = nodes.acquire(item);
                  onCleanup(() => nodes.release(item));
                  return <div class="layout-card-grid__cell">{holder}</div>;
                }}
              </For>
            ),
            () => itemsOf(slot).length,
          )
        }
      </WindowVirtualizer>
    );
  }
}
