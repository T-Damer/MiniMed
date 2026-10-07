export const PINCH_ZOOM_MIN = 1;
export const PINCH_ZOOM_MAX = 3;
export const PINCH_ZOOM_STEP = 0.25;
/** Scale a double tap / double click zooms to (and back from). */
export const PINCH_ZOOM_DOUBLE_TAP_SCALE = 2;

export interface PinchPoint {
  readonly x: number;
  readonly y: number;
}

export interface PinchSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Zoomed content as `translate(x, y) scale(scale)` with the origin in the top-left corner: a point
 * `p` of the unscaled content is drawn at `p * scale + (x, y)` inside the surface.
 */
export interface PanZoom {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const PINCH_ZOOM_IDENTITY: PanZoom = { scale: PINCH_ZOOM_MIN, x: 0, y: 0 };

export function clampPinchScale(value: number): number {
  if (!Number.isFinite(value)) return PINCH_ZOOM_MIN;
  return Math.max(PINCH_ZOOM_MIN, Math.min(PINCH_ZOOM_MAX, value));
}

export function stepPinchScale(current: number, direction: 1 | -1): number {
  return clampPinchScale(current + direction * PINCH_ZOOM_STEP);
}

/** Layout size of a 1× box after scale, used to grow the scrollport. */
export function pinchScaledScrollSize(natural: number, scale: number): number {
  return Math.max(0, natural * clampPinchScale(scale));
}

/** The point of the unscaled content that is drawn at `point` (surface coordinates). */
export function contentPointAt(state: PanZoom, point: PinchPoint): PinchPoint {
  return { x: (point.x - state.x) / state.scale, y: (point.y - state.y) / state.scale };
}

/**
 * Pan limits: zoomed content always covers the whole surface, so no empty margin shows. At scale 1
 * the only valid offset is 0.
 */
export function clampPanZoom(state: PanZoom, size: PinchSize): PanZoom {
  const scale = clampPinchScale(state.scale);
  const x = Math.min(0, Math.max(size.width * (1 - scale), state.x));
  const y = Math.min(0, Math.max(size.height * (1 - scale), state.y));
  return { scale, x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/**
 * Puts the content point `content` under `focal` at `nextScale` and keeps the content inside the
 * surface. This is the one rule behind wheel, pinch, double tap and the buttons: the point being
 * looked at stays where it is, instead of the zoom running from the content's centre or corner.
 */
export function placeContentPoint(
  content: PinchPoint,
  focal: PinchPoint,
  nextScale: number,
  size: PinchSize,
): PanZoom {
  const scale = clampPinchScale(nextScale);
  return clampPanZoom(
    { scale, x: focal.x - content.x * scale, y: focal.y - content.y * scale },
    size,
  );
}

/** Zoom to `nextScale` around `focal` (surface coordinates) from the current state. */
export function zoomAbout(
  state: PanZoom,
  focal: PinchPoint,
  nextScale: number,
  size: PinchSize,
): PanZoom {
  return placeContentPoint(contentPointAt(state, focal), focal, nextScale, size);
}

/** What a pinch has to know about its first frame. */
export interface PinchStart {
  /** Content point under the two fingers' centroid when the pinch began. */
  readonly content: PinchPoint;
  readonly scale: number;
  readonly distance: number;
}

export function startPinch(
  state: PanZoom,
  first: PinchPoint,
  second: PinchPoint,
): PinchStart | null {
  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  if (distance <= 0) return null;
  return {
    content: contentPointAt(state, midpoint(first, second)),
    scale: state.scale,
    distance,
  };
}

export function midpoint(first: PinchPoint, second: PinchPoint): PinchPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * The state for the fingers now at `first` and `second`: scaled by how far they moved apart and
 * panned so the content point first held between them follows their centroid.
 */
export function pinchPanZoom(
  start: PinchStart,
  first: PinchPoint,
  second: PinchPoint,
  size: PinchSize,
): PanZoom {
  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  const ratio = start.distance > 0 ? distance / start.distance : 1;
  return placeContentPoint(start.content, midpoint(first, second), start.scale * ratio, size);
}

/** Double tap: zoom in to the tapped point, or back out when already zoomed. */
export function doubleTapScale(current: number): number {
  return current > PINCH_ZOOM_MIN + 0.05 ? PINCH_ZOOM_MIN : PINCH_ZOOM_DOUBLE_TAP_SCALE;
}

export const DOUBLE_TAP_MAX_INTERVAL_MS = 320;
export const DOUBLE_TAP_MAX_DISTANCE = 28;

export interface TapRecord extends PinchPoint {
  readonly time: number;
}

export function isDoubleTap(previous: TapRecord | null, next: TapRecord): boolean {
  if (!previous) return false;
  return (
    next.time - previous.time <= DOUBLE_TAP_MAX_INTERVAL_MS &&
    Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_MAX_DISTANCE
  );
}

/**
 * Scale factor of one wheel event. A trackpad pinch (Chromium sends it as Ctrl+wheel) comes in many
 * small deltas; a mouse wheel notch is one large one, so it gets a gentler curve.
 */
export function wheelScaleFactor(deltaY: number, deltaMode: number, pinchGesture: boolean): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-120, Math.min(120, pixels));
  return Math.exp(-clamped * (pinchGesture ? 0.01 : 0.003));
}

/**
 * Scroll offset that keeps `content` (an unscaled content point) under `focal` when the content is
 * drawn at `scale` inside a scrolled box. `origin` is the content's top-left corner in client
 * coordinates at that scale and the current scroll, `focal` is in client coordinates too. Browser
 * scrolling clamps the result; a negative target means «already at the start».
 */
export function scrollDeltaForFocal(
  origin: PinchPoint,
  content: PinchPoint,
  focal: PinchPoint,
  scale: number,
): PinchPoint {
  return { x: origin.x + content.x * scale - focal.x, y: origin.y + content.y * scale - focal.y };
}
