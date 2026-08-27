import { describe, expect, it } from 'vitest';

import { eraseMedicalImageStrokes } from '@/features/library/medical-image-annotation-geometry';

describe('medical image annotations', () => {
  it('erases an entire stroke when the eraser crosses one of its segments', () => {
    const strokes = [
      {
        id: 'red',
        color: 'red' as const,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.9 },
        ],
      },
      {
        id: 'blue',
        color: 'blue' as const,
        points: [
          { x: 0.1, y: 0.9 },
          { x: 0.2, y: 0.9 },
        ],
      },
    ];

    expect(eraseMedicalImageStrokes(strokes, { x: 0.5, y: 0.5 }, 0.02)).toEqual([strokes[1]]);
  });
});
