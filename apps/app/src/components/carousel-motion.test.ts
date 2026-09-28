import { describe, expect, it } from 'vitest';

import { carouselAutoplayMayAdvance, carouselIndexAt, carouselStep } from './carousel-motion';

describe('carouselStep', () => {
  it('wraps at both ends and tolerates an empty carousel', () => {
    expect(carouselStep(0, 3, 1)).toBe(1);
    expect(carouselStep(2, 3, 1)).toBe(0);
    expect(carouselStep(0, 3, -1)).toBe(2);
    expect(carouselStep(0, 0, 1)).toBe(0);
  });
});

describe('carouselIndexAt', () => {
  it('snaps to the nearest slide and stays in range', () => {
    expect(carouselIndexAt(0, 320, 4)).toBe(0);
    expect(carouselIndexAt(170, 320, 4)).toBe(1);
    expect(carouselIndexAt(5000, 320, 4)).toBe(3);
    expect(carouselIndexAt(10, 0, 4)).toBe(0);
  });
});

describe('carouselAutoplayMayAdvance', () => {
  const idle = { reducedMotion: false, takenOver: false, held: false, pageHidden: false };

  it('advances only while nobody is looking closely, and never with reduced motion', () => {
    expect(carouselAutoplayMayAdvance(idle)).toBe(true);
    expect(carouselAutoplayMayAdvance({ ...idle, reducedMotion: true })).toBe(false);
    expect(carouselAutoplayMayAdvance({ ...idle, takenOver: true })).toBe(false);
    expect(carouselAutoplayMayAdvance({ ...idle, held: true })).toBe(false);
    expect(carouselAutoplayMayAdvance({ ...idle, pageHidden: true })).toBe(false);
  });
});
