import { describe, expect, it } from 'vitest';

import { maxUnclippedScale, pressScale, springBackKeyframes } from '@/components/press-feedback';

describe('press feedback', () => {
  it('shrinks small controls to 0.96 and wide rows only a little', () => {
    expect(pressScale(44, 44, 390, 844)).toBe(0.96);
    expect(pressScale(150, 48, 390, 844)).toBe(0.96);
    expect(pressScale(360, 66, 390, 844)).toBe(0.98);
  });

  it('leaves big surfaces and empty boxes alone', () => {
    expect(pressScale(360, 500, 390, 844)).toBeNull();
    expect(pressScale(0, 40, 390, 844)).toBeNull();
    expect(pressScale(40, 0, 390, 844)).toBeNull();
  });
});

describe('press spring', () => {
  it('lets a control grow only into the room its clipping box leaves', () => {
    const box = { left: 100, top: 100, right: 200, bottom: 140 };
    expect(maxUnclippedScale(box, { left: 0, top: 0, right: 400, bottom: 800 })).toBeCloseTo(3);
    // Flush with the card's edge: no room, no overshoot.
    expect(maxUnclippedScale(box, { left: 100, top: 0, right: 400, bottom: 800 })).toBe(1);
    // Two pixels above and below a 40 px tall chip: at most 1.1.
    expect(maxUnclippedScale(box, { left: 0, top: 98, right: 400, bottom: 142 })).toBeCloseTo(1.1);
  });

  it('springs past full size and settles at 1, or returns plainly without room', () => {
    const frames = springBackKeyframes(0.96, 1.04);
    expect(frames[0]?.['scale']).toBe('0.9600');
    expect(frames.map((frame) => Number(frame['scale']))).toContain(1.04);
    expect(frames.at(-1)?.['scale']).toBe('1');
    expect(Math.min(...frames.slice(1).map((frame) => Number(frame['scale'])))).toBeGreaterThan(
      0.98,
    );
    expect(springBackKeyframes(0.96, 1)).toEqual([{ scale: '0.96' }, { scale: '1' }]);
  });
});
