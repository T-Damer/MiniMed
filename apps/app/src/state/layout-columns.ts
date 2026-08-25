import { createSignal, onCleanup, onMount } from 'solid-js';

/** Must match `breakpoints.css` tablet query. */
export const LAYOUT_TABLET_MIN_PX = 760;
export const LAYOUT_WIDE_MIN_PX = 1180;
export type LayoutColumnCount = 1 | 2 | 3;

export function layoutColumnCount(
  widthPx: number,
  maxColumns: 1 | 2 | 3 = 2,
  minTwoColumnWidth = LAYOUT_TABLET_MIN_PX,
): LayoutColumnCount {
  if (maxColumns >= 3 && widthPx >= LAYOUT_WIDE_MIN_PX) return 3;
  if (maxColumns >= 2 && widthPx >= minTwoColumnWidth) return 2;
  return 1;
}

export function chunkLayoutRows<T>(
  items: readonly T[],
  columns: number,
): readonly (readonly T[])[] {
  const cols = Math.max(1, Math.floor(columns));
  if (items.length === 0) return [];
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += cols) {
    rows.push(items.slice(index, index + cols));
  }
  return rows;
}

export function createLayoutColumnCount(
  maxColumns: 1 | 2 | 3 = 2,
  minTwoColumnWidth = LAYOUT_TABLET_MIN_PX,
) {
  const [columns, setColumns] = createSignal<LayoutColumnCount>(
    typeof window === 'undefined'
      ? 1
      : layoutColumnCount(window.innerWidth, maxColumns, minTwoColumnWidth),
  );

  onMount(() => {
    const breakpoints = [minTwoColumnWidth, ...(maxColumns >= 3 ? [LAYOUT_WIDE_MIN_PX] : [])];
    const queries = [...new Set(breakpoints)].map((width) =>
      window.matchMedia(`(min-width: ${width}px)`),
    );
    const sync = (): void => {
      setColumns(layoutColumnCount(window.innerWidth, maxColumns, minTwoColumnWidth));
    };
    for (const query of queries) query.addEventListener('change', sync);
    sync();
    onCleanup(() => {
      for (const query of queries) query.removeEventListener('change', sync);
    });
  });

  return columns;
}
