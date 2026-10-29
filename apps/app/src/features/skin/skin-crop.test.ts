import { describe, expect, it } from 'vitest';

import { outputSide, squareCrop } from '@/features/skin/skin-crop';

describe('square crop', () => {
  it('centres the largest square', () => {
    expect(squareCrop(1920, 1080)).toEqual({ sx: 420, sy: 0, size: 1080 });
    expect(squareCrop(1080, 1920)).toEqual({ sx: 0, sy: 420, size: 1080 });
    expect(squareCrop(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
  });

  it('never upscales and respects the side limit', () => {
    expect(outputSide(300, 1024)).toBe(300);
    expect(outputSide(3000, 1024)).toBe(1024);
  });
});
