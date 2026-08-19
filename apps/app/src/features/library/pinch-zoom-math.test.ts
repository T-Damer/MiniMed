import { describe, expect, it } from 'vitest';

import {
  clampPinchScale,
  PINCH_ZOOM_MAX,
  PINCH_ZOOM_MIN,
  PINCH_ZOOM_STEP,
  pinchScaledScrollSize,
  stepPinchScale,
} from '@/features/library/pinch-zoom-math';

describe('pinch-zoom math', () => {
  it('clamps scale between min and max', () => {
    expect(clampPinchScale(0.5)).toBe(PINCH_ZOOM_MIN);
    expect(clampPinchScale(4)).toBe(PINCH_ZOOM_MAX);
    expect(clampPinchScale(1.5)).toBe(1.5);
  });

  it('steps scale by 0.25 and clamps', () => {
    expect(stepPinchScale(1, 1)).toBe(1 + PINCH_ZOOM_STEP);
    expect(stepPinchScale(PINCH_ZOOM_MAX, 1)).toBe(PINCH_ZOOM_MAX);
    expect(stepPinchScale(1.25, -1)).toBe(1);
    expect(stepPinchScale(PINCH_ZOOM_MIN, -1)).toBe(PINCH_ZOOM_MIN);
  });

  it('grows the scrollport by clamped scale', () => {
    expect(pinchScaledScrollSize(200, 2)).toBe(400);
    expect(pinchScaledScrollSize(200, 0.5)).toBe(200);
    expect(pinchScaledScrollSize(200, 4)).toBe(600);
    expect(pinchScaledScrollSize(-10, 2)).toBe(0);
  });
});
