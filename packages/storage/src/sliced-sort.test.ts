import { describe, expect, it } from 'vitest';

import { SortedListingMemo, stableSortSliced } from './sliced-sort';

describe('stableSortSliced', () => {
  const collator = new Intl.Collator();

  it('gives exactly the stable sort of the input, ties in their input order', async () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 48271) % 2147483647;
      return seed;
    };
    const items = Array.from({ length: 5000 }, (_, index) => ({
      name: `имя ${String(random() % 300)}`,
      index,
    }));
    const compare = (left: { name: string }, right: { name: string }): number =>
      collator.compare(left.name, right.name);
    expect(await stableSortSliced(items, compare)).toEqual(items.toSorted(compare));
  });

  it('handles empty and single inputs', async () => {
    expect(await stableSortSliced([], () => 0)).toEqual([]);
    expect(await stableSortSliced([1], (a, b) => a - b)).toEqual([1]);
  });
});

describe('SortedListingMemo', () => {
  it('answers only for the very same input arrays', () => {
    const memo = new SortedListingMemo<number>();
    const a = [2, 1];
    const b = [3];
    memo.keep([a, b], [1, 2, 3]);
    expect(memo.find([a, b])).toEqual([1, 2, 3]);
    expect(memo.find([a, [3]])).toBeUndefined();
    expect(memo.find([a])).toBeUndefined();
  });
});
