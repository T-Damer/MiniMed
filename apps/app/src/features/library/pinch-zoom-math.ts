export const PINCH_ZOOM_MIN = 1;
export const PINCH_ZOOM_MAX = 3;
export const PINCH_ZOOM_STEP = 0.25;

export function clampPinchScale(value: number): number {
  return Math.max(PINCH_ZOOM_MIN, Math.min(PINCH_ZOOM_MAX, value));
}

export function stepPinchScale(current: number, direction: 1 | -1): number {
  return clampPinchScale(current + direction * PINCH_ZOOM_STEP);
}

/** Layout size of a 1× box after scale, used to grow the scrollport. */
export function pinchScaledScrollSize(natural: number, scale: number): number {
  return Math.max(0, natural * clampPinchScale(scale));
}
