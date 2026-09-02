import { describe, expect, it } from 'vitest';

import { rectifyEcgPhotoRgb } from '@/features/calculators/ecg-photo-rectification';

const FULL_IMAGE = {
  bottomLeft: { x: 0, y: 1 },
  bottomRight: { x: 1, y: 1 },
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
} as const;

describe('ECG photo rectification', () => {
  it('preserves an image when all four corners are selected', () => {
    const data = Uint8Array.from({ length: 4 * 3 * 3 }, (_, index) => index * 7);
    const result = rectifyEcgPhotoRgb({ data, height: 3, width: 4 }, FULL_IMAGE);

    expect(result).toEqual({ data, height: 3, width: 4 });
  });

  it('maps the four output corners to a confirmed quadrilateral', () => {
    const width = 10;
    const height = 10;
    const data = new Uint8Array(width * height * 3);
    const sourceCorners = [
      { color: [255, 0, 0], x: 2, y: 1 },
      { color: [0, 255, 0], x: 8, y: 2 },
      { color: [0, 0, 255], x: 7, y: 8 },
      { color: [255, 255, 0], x: 1, y: 7 },
    ] as const;
    for (const corner of sourceCorners) {
      data.set(corner.color, (corner.y * width + corner.x) * 3);
    }
    const result = rectifyEcgPhotoRgb(
      { data, height, width },
      {
        bottomLeft: { x: 1 / 9, y: 7 / 9 },
        bottomRight: { x: 7 / 9, y: 8 / 9 },
        topLeft: { x: 2 / 9, y: 1 / 9 },
        topRight: { x: 8 / 9, y: 2 / 9 },
      },
    );

    const pixel = (x: number, y: number) => [
      ...result.data.slice((y * result.width + x) * 3, (y * result.width + x) * 3 + 3),
    ];
    expect(pixel(0, 0)).toEqual([255, 0, 0]);
    expect(pixel(result.width - 1, 0)).toEqual([0, 255, 0]);
    expect(pixel(result.width - 1, result.height - 1)).toEqual([0, 0, 255]);
    expect(pixel(0, result.height - 1)).toEqual([255, 255, 0]);
  });

  it('rejects crossing corners', () => {
    expect(() =>
      rectifyEcgPhotoRgb(
        { data: new Uint8Array(10 * 10 * 3), height: 10, width: 10 },
        { ...FULL_IMAGE, bottomLeft: { x: 1, y: 1 }, bottomRight: { x: 0, y: 1 } },
      ),
    ).toThrow(/выпуклый контур/u);
  });
});
