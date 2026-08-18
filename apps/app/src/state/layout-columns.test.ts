import { describe, expect, it } from 'vitest';

import { chunkLayoutRows, LAYOUT_TABLET_MIN_PX, layoutColumnCount } from '@/state/layout-columns';

describe('layoutColumnCount', () => {
  it('uses one column on phone and two from tablet upward', () => {
    expect(layoutColumnCount(LAYOUT_TABLET_MIN_PX - 1)).toBe(1);
    expect(layoutColumnCount(LAYOUT_TABLET_MIN_PX)).toBe(2);
    expect(layoutColumnCount(2560)).toBe(2);
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
