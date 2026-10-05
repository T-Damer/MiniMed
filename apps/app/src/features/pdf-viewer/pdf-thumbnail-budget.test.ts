import { describe, expect, it } from 'vitest';

import { ThumbnailBudget } from './pdf-thumbnail-budget';

describe('ThumbnailBudget', () => {
  it('releases the least recently used off-screen thumbnails over the cap', () => {
    const budget = new ThumbnailBudget(300);
    const released: number[] = [];
    for (const page of [1, 2, 3]) {
      budget.add(page, { bytes: 100, release: () => released.push(page) });
    }
    expect(released).toEqual([]);
    budget.add(4, { bytes: 100, release: () => released.push(4) });
    expect(released).toEqual([1]);
    expect(budget.totalBytes).toBe(300);
  });

  it('never releases a thumbnail that is on screen', () => {
    const budget = new ThumbnailBudget(200);
    const released: number[] = [];
    budget.add(1, { bytes: 100, release: () => released.push(1) });
    budget.setVisible(1, true);
    budget.add(2, { bytes: 100, release: () => released.push(2) });
    budget.add(3, { bytes: 100, release: () => released.push(3) });
    expect(released).toEqual([2]);
    expect(budget.has(1)).toBe(true);
  });

  it('counts a page that scrolled out as recently used, then evicts when over the cap', () => {
    const budget = new ThumbnailBudget(200);
    const released: number[] = [];
    budget.add(1, { bytes: 100, release: () => released.push(1) });
    budget.add(2, { bytes: 100, release: () => released.push(2) });
    budget.setVisible(1, true);
    budget.add(3, { bytes: 100, release: () => released.push(3) });
    expect(released).toEqual([2]);
    budget.setVisible(1, false);
    expect(released).toEqual([2]);
    budget.add(4, { bytes: 100, release: () => released.push(4) });
    expect(released).toEqual([2, 3]);
  });
});
