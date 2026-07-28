import { describe, expect, it, vi } from 'vitest';

import { translateVerticalWheelToHorizontal } from './horizontal-wheel-scroll';

describe('translateVerticalWheelToHorizontal', () => {
  it('moves an overflowing row and leaves the page wheel alone at its edge', () => {
    const preventDefault = vi.fn();
    const scroller = { scrollWidth: 500, clientWidth: 200, scrollLeft: 100 };

    translateVerticalWheelToHorizontal({ deltaX: 0, deltaY: 40, preventDefault }, scroller);
    expect(scroller.scrollLeft).toBe(140);
    expect(preventDefault).toHaveBeenCalledOnce();

    scroller.scrollLeft = 300;
    preventDefault.mockClear();
    translateVerticalWheelToHorizontal({ deltaX: 0, deltaY: 40, preventDefault }, scroller);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
