import { describe, expect, it } from 'vitest';

import { lineCount, MIN_HIDDEN_LINES, shouldFold, visibleItemCount } from '@/components/line-clamp';

describe('line clamp rule', () => {
  it('folds only when at least three lines would be hidden', () => {
    expect(MIN_HIDDEN_LINES).toBe(3);
    expect(shouldFold(4, 4)).toBe(false);
    expect(shouldFold(5, 4)).toBe(false);
    expect(shouldFold(6, 4)).toBe(false);
    expect(shouldFold(7, 4)).toBe(true);
    expect(shouldFold(20, 3)).toBe(true);
  });

  it('counts lines by rounding the content height to whole line boxes', () => {
    expect(lineCount(87, 21.75)).toBe(4);
    expect(lineCount(108, 21.75)).toBe(5);
    expect(lineCount(0, 20)).toBe(0);
    expect(lineCount(100, 0)).toBe(0);
  });

  it('shows every item when the fold would hide only one or two', () => {
    expect(visibleItemCount(3, 2)).toBe(3);
    expect(visibleItemCount(4, 2)).toBe(4);
    expect(visibleItemCount(5, 2)).toBe(2);
    expect(visibleItemCount(2, 6)).toBe(2);
    expect(visibleItemCount(8, 6)).toBe(8);
    expect(visibleItemCount(9, 6)).toBe(6);
  });
});
