/** Must match `breakpoints.css` tablet query. */
export const LAYOUT_TABLET_MIN_PX = 760;
export const LAYOUT_WIDE_MIN_PX = 1180;
export const LAYOUT_FOUR_COLUMN_MIN_PX = 960;
export const LAYOUT_SIX_COLUMN_MIN_PX = 1440;
export type LayoutColumnCount = 1 | 2 | 3 | 4 | 5 | 6;

export function layoutColumnCount(
  widthPx: number,
  maxColumns: LayoutColumnCount = 2,
  minColumns: LayoutColumnCount = 1,
): LayoutColumnCount {
  const minimum = minColumns > maxColumns ? maxColumns : minColumns;
  if (widthPx < LAYOUT_TABLET_MIN_PX) return minimum;
  if (maxColumns >= 6 && widthPx >= LAYOUT_SIX_COLUMN_MIN_PX) return 6;
  if (maxColumns >= 6 && widthPx >= LAYOUT_TABLET_MIN_PX) return 5;
  if (maxColumns >= 5 && widthPx >= LAYOUT_WIDE_MIN_PX) return 5;
  if (maxColumns >= 4 && widthPx >= LAYOUT_FOUR_COLUMN_MIN_PX) return 4;
  if (maxColumns >= 3 && widthPx >= LAYOUT_WIDE_MIN_PX) return 3;
  if (maxColumns >= 2) return 2;
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
