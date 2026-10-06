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

/**
 * Splits items into rows of `columns`. A row whose items are the same references, in the same
 * order, as a row of `previous` is returned as that previous array: virtualizers key their rows by
 * reference, so an update to one item's fields keeps every row's DOM (and focus inside it) alive.
 */
export function chunkLayoutRows<T>(
  items: readonly T[],
  columns: number,
  previous: readonly (readonly T[])[] = [],
): readonly (readonly T[])[] {
  const cols = Math.max(1, Math.floor(columns));
  if (items.length === 0) return [];
  const previousByFirst = new Map<T, readonly T[]>();
  for (const row of previous) {
    if (row.length > 0) previousByFirst.set(row[0] as T, row);
  }
  const rows: (readonly T[])[] = [];
  for (let index = 0; index < items.length; index += cols) {
    const row = items.slice(index, index + cols);
    const kept = previousByFirst.get(row[0] as T);
    rows.push(kept && sameRow(kept, row) ? kept : row);
  }
  return rows;
}

function sameRow<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
