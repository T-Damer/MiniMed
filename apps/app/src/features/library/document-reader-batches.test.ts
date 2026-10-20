import { describe, expect, it } from 'vitest';

import {
  FIRST_SLICE_WEIGHT,
  firstSliceCount,
  IDLE_SLICE_WEIGHT,
  MAX_SECTIONS_PER_SLICE,
  nextSliceCount,
} from '@/features/library/document-reader-batches';

describe('first slice', () => {
  it('stops once a screen of text is mounted', () => {
    expect(firstSliceCount([1500, 1500, 4000, 4000], -1)).toBe(2);
    expect(firstSliceCount([FIRST_SLICE_WEIGHT + 1, 10, 10], -1)).toBe(1);
  });

  it('takes at least one section and never more than the document has', () => {
    expect(firstSliceCount([], -1)).toBe(0);
    expect(firstSliceCount([5], -1)).toBe(1);
    expect(firstSliceCount([0, 0], -1)).toBe(2);
  });

  it('counts headings without text as almost nothing, up to a cap', () => {
    expect(
      firstSliceCount(
        Array.from({ length: 30 }, () => 0),
        -1,
      ),
    ).toBe(MAX_SECTIONS_PER_SLICE);
  });

  it('reaches the section that holds the place the reader opens at', () => {
    expect(firstSliceCount([100, 100, 100, 100, 100, 100, 100, 100, 100, 100], 12)).toBe(10);
    expect(firstSliceCount([3000, 100, 100, 100, 100, 100], 4)).toBe(5);
  });
});

describe('idle slices', () => {
  it('add a couple of pages of text, never less than one section', () => {
    const weights = [3000, 3000, 3000, 9000, 100];
    expect(nextSliceCount(weights, 1)).toBe(3);
    expect(nextSliceCount(weights, 3)).toBe(4);
    expect(nextSliceCount(weights, 4)).toBe(5);
  });

  it('end at the last section', () => {
    expect(nextSliceCount([10, 10], 2)).toBe(2);
    expect(nextSliceCount([10, 10], 9)).toBe(2);
    expect(nextSliceCount([IDLE_SLICE_WEIGHT * 3, 10], 0)).toBe(1);
  });

  it('walk a whole document in a bounded number of slices', () => {
    const weights = Array.from({ length: 41 }, (_, index) => 200 + index * 90);
    let mounted = firstSliceCount(weights, -1);
    let slices = 1;
    while (mounted < weights.length) {
      const next = nextSliceCount(weights, mounted);
      expect(next).toBeGreaterThan(mounted);
      mounted = next;
      slices += 1;
    }
    expect(slices).toBeLessThan(weights.length);
  });
});
