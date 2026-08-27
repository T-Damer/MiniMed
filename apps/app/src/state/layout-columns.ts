import { createSignal, onCleanup, onMount } from 'solid-js';

/** Must match `breakpoints.css` tablet query. */
export const LAYOUT_TABLET_MIN_PX = 760;
export const LAYOUT_WIDE_MIN_PX = 1180;
export const LAYOUT_FOUR_COLUMN_MIN_PX = 960;
export const LAYOUT_SIX_COLUMN_MIN_PX = 1440;
export type LayoutColumnCount = 1 | 2 | 3 | 4 | 5 | 6;

export function layoutColumnCount(
  widthPx: number,
  maxColumns: LayoutColumnCount = 2,
  minTwoColumnWidth = LAYOUT_TABLET_MIN_PX,
): LayoutColumnCount {
  if (maxColumns >= 6 && widthPx >= LAYOUT_SIX_COLUMN_MIN_PX) return 6;
  if (maxColumns >= 5 && widthPx >= LAYOUT_WIDE_MIN_PX) return 5;
  if (maxColumns >= 4 && widthPx >= LAYOUT_FOUR_COLUMN_MIN_PX) return 4;
  if (maxColumns >= 6 && widthPx >= LAYOUT_TABLET_MIN_PX) return 3;
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
  maxColumns: LayoutColumnCount = 2,
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
