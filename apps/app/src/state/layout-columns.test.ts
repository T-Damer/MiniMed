import { describe, expect, it } from 'vitest';

import {
  chunkLayoutRows,
  LAYOUT_FOUR_COLUMN_MIN_PX,
  LAYOUT_SIX_COLUMN_MIN_PX,
  LAYOUT_TABLET_MIN_PX,
  LAYOUT_WIDE_MIN_PX,
  layoutColumnCount,
} from '@/state/layout-columns';

describe('layoutColumnCount', () => {
  it('uses one column on phone and two from tablet upward', () => {
    expect(layoutColumnCount(LAYOUT_TABLET_MIN_PX - 1)).toBe(1);
    expect(layoutColumnCount(LAYOUT_TABLET_MIN_PX)).toBe(2);
    expect(layoutColumnCount(2560)).toBe(2);
  });

  it('keeps default file grids to one column on phones', () => {
    expect(layoutColumnCount(390, 6)).toBe(1);
    expect(layoutColumnCount(LAYOUT_TABLET_MIN_PX, 3)).toBe(2);
    expect(layoutColumnCount(LAYOUT_WIDE_MIN_PX, 3)).toBe(3);
  });

  it('supports a minimum column count for narrow feature grids', () => {
    expect(layoutColumnCount(274, 6, 2)).toBe(2);
    expect(layoutColumnCount(LAYOUT_TABLET_MIN_PX, 6, 2)).toBe(5);
  });

  it('expands the wide file grid while keeping mobile columns compact', () => {
    expect(layoutColumnCount(LAYOUT_TABLET_MIN_PX, 6)).toBe(5);
    expect(layoutColumnCount(LAYOUT_FOUR_COLUMN_MIN_PX, 6)).toBe(5);
    expect(layoutColumnCount(LAYOUT_WIDE_MIN_PX, 6)).toBe(5);
    expect(layoutColumnCount(LAYOUT_SIX_COLUMN_MIN_PX, 6)).toBe(6);
  });
});

describe('chunkLayoutRows', () => {
  it('keeps a single column as one item per row', () => {
    expect(chunkLayoutRows(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
  });

  it('fills complete rows then a short last row', () => {
    expect(chunkLayoutRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns no rows for an empty list', () => {
    expect(chunkLayoutRows([], 2)).toEqual([]);
  });
});
