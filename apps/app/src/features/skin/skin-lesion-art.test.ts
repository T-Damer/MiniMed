import { describe, expect, it } from 'vitest';

import {
  blobPath,
  lesionArtShapes,
  lesionPositions,
  seededRandom,
} from '@/features/skin/skin-lesion-art';

describe('lesion art', () => {
  it('draws the same picture for the same spec', () => {
    const art = {
      caption: 'Бляшка',
      layers: [{ element: 'plaque', size: 20, surface: ['scale'], seed: 5 }],
    } as const;
    expect(lesionArtShapes(art)).toEqual(lesionArtShapes(art));
  });

  it('closes every outline', () => {
    expect(blobPath(50, 50, 10, 0.4, seededRandom(1))).toMatch(/^M[\d. -]+C.*Z$/u);
  });

  it('keeps scattered elements inside the picture and apart', () => {
    const points = lesionPositions('scattered', 20, 3, seededRandom(9));
    expect(points.length).toBeGreaterThan(10);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });

  it('places an annular pattern on a ring', () => {
    for (const [x, y] of lesionPositions('annular', 12, 2, seededRandom(3))) {
      expect(Math.hypot(x - 50, y - 50)).toBeGreaterThan(24);
      expect(Math.hypot(x - 50, y - 50)).toBeLessThan(32);
    }
  });
});
