import { describe, expect, it } from 'vitest';

import {
  clampPanZoom,
  clampPinchScale,
  contentPointAt,
  DOUBLE_TAP_MAX_DISTANCE,
  DOUBLE_TAP_MAX_INTERVAL_MS,
  doubleTapScale,
  isDoubleTap,
  type PanZoom,
  PINCH_ZOOM_DOUBLE_TAP_SCALE,
  PINCH_ZOOM_IDENTITY,
  PINCH_ZOOM_MAX,
  PINCH_ZOOM_MIN,
  PINCH_ZOOM_STEP,
  pinchPanZoom,
  pinchScaledScrollSize,
  placeContentPoint,
  scrollDeltaForFocal,
  startPinch,
  stepPinchScale,
  wheelScaleFactor,
  zoomAbout,
} from '@/features/library/pinch-zoom-math';

const SIZE = { width: 400, height: 300 };

/** Where the content point `content` is drawn for a state (the inverse of `contentPointAt`). */
function drawnAt(state: PanZoom, content: { x: number; y: number }): { x: number; y: number } {
  return { x: content.x * state.scale + state.x, y: content.y * state.scale + state.y };
}

describe('pinch-zoom math', () => {
  it('clamps scale between min and max', () => {
    expect(clampPinchScale(0.5)).toBe(PINCH_ZOOM_MIN);
    expect(clampPinchScale(4)).toBe(PINCH_ZOOM_MAX);
    expect(clampPinchScale(1.5)).toBe(1.5);
    expect(clampPinchScale(Number.NaN)).toBe(PINCH_ZOOM_MIN);
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

describe('focal-point zoom', () => {
  it('keeps the point under the cursor fixed, not the surface centre', () => {
    const focal = { x: 100, y: 60 };
    const zoomed = zoomAbout(PINCH_ZOOM_IDENTITY, focal, 2, SIZE);
    // The content point that was under the cursor is still drawn under it.
    expect(drawnAt(zoomed, contentPointAt(PINCH_ZOOM_IDENTITY, focal))).toEqual(focal);
    expect(zoomed).toEqual({ scale: 2, x: -100, y: -60 });
    // Zooming around the centre would have given x = -200, y = -150.
    expect(zoomed.x).not.toBe(-200);
    expect(zoomed.y).not.toBe(-150);
  });

  it('keeps the point fixed over repeated wheel steps', () => {
    const focal = { x: 320, y: 90 };
    const anchor = contentPointAt(PINCH_ZOOM_IDENTITY, focal);
    let state: PanZoom = PINCH_ZOOM_IDENTITY;
    for (const scale of [1.2, 1.5, 1.9, 2.4]) {
      state = zoomAbout(state, focal, scale, SIZE);
      expect(drawnAt(state, anchor).x).toBeCloseTo(focal.x, 6);
      expect(drawnAt(state, anchor).y).toBeCloseTo(focal.y, 6);
    }
  });

  it('zooms back out around the same point and ends at the identity', () => {
    const focal = { x: 50, y: 250 };
    const zoomed = zoomAbout(PINCH_ZOOM_IDENTITY, focal, 3, SIZE);
    const back = zoomAbout(zoomed, focal, 1, SIZE);
    expect(back).toEqual(PINCH_ZOOM_IDENTITY);
  });

  it('clamps the pan so the content always covers the surface', () => {
    // Zoomed to the bottom-right corner, then zoomed out around the top-left corner: following the
    // cursor exactly would leave an empty margin at the right and bottom, so the pan is clamped.
    const corner = zoomAbout(PINCH_ZOOM_IDENTITY, { x: 399, y: 299 }, 3, SIZE);
    const out = zoomAbout(corner, { x: 0, y: 0 }, 2, SIZE);
    expect(out).toEqual({ scale: 2, x: -SIZE.width, y: -SIZE.height });
    const left = zoomAbout(PINCH_ZOOM_IDENTITY, { x: 0, y: 0 }, 3, SIZE);
    expect(left).toEqual({ scale: 3, x: 0, y: 0 });
    expect(clampPanZoom({ scale: 2, x: 50, y: 50 }, SIZE)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(clampPanZoom({ scale: 2, x: -999, y: -999 }, SIZE)).toEqual({
      scale: 2,
      x: -SIZE.width,
      y: -SIZE.height,
    });
  });

  it('clamps scale and keeps the identity pannable only at zero', () => {
    expect(zoomAbout(PINCH_ZOOM_IDENTITY, { x: 10, y: 10 }, 9, SIZE).scale).toBe(PINCH_ZOOM_MAX);
    expect(clampPanZoom({ scale: 1, x: -40, y: 12 }, SIZE)).toEqual(PINCH_ZOOM_IDENTITY);
  });

  it('places an arbitrary content point under a focal point', () => {
    const state = placeContentPoint({ x: 200, y: 150 }, { x: 200, y: 150 }, 2, SIZE);
    expect(state).toEqual({ scale: 2, x: -200, y: -150 });
  });
});

describe('pinch gesture', () => {
  it('scales by the change in finger distance around the starting centroid', () => {
    const start = startPinch(PINCH_ZOOM_IDENTITY, { x: 150, y: 100 }, { x: 250, y: 100 });
    if (!start) throw new Error('pinch did not start');
    // Fingers move symmetrically apart: the centroid stays at (200, 100), the distance doubles.
    const state = pinchPanZoom(start, { x: 100, y: 100 }, { x: 300, y: 100 }, SIZE);
    expect(state.scale).toBe(2);
    expect(drawnAt(state, start.content)).toEqual({ x: 200, y: 100 });
  });

  it('follows the centroid when the fingers drift (two-finger pan)', () => {
    const start = startPinch(PINCH_ZOOM_IDENTITY, { x: 150, y: 150 }, { x: 250, y: 150 });
    if (!start) throw new Error('pinch did not start');
    const zoomed = pinchPanZoom(start, { x: 100, y: 150 }, { x: 300, y: 150 }, SIZE);
    // Same finger distance, centroid moved 40px left and 20px down.
    const panned = pinchPanZoom(start, { x: 60, y: 170 }, { x: 260, y: 170 }, SIZE);
    expect(panned.scale).toBe(zoomed.scale);
    expect(drawnAt(panned, start.content)).toEqual({ x: 160, y: 170 });
  });

  it('keeps starting from the already zoomed state', () => {
    const base = zoomAbout(PINCH_ZOOM_IDENTITY, { x: 100, y: 100 }, 1.5, SIZE);
    const start = startPinch(base, { x: 180, y: 150 }, { x: 220, y: 150 });
    if (!start) throw new Error('pinch did not start');
    const state = pinchPanZoom(start, { x: 160, y: 150 }, { x: 240, y: 150 }, SIZE);
    expect(state.scale).toBeCloseTo(3, 6);
    expect(drawnAt(state, start.content).x).toBeCloseTo(200, 6);
  });

  it('does not start with both fingers on one point', () => {
    expect(startPinch(PINCH_ZOOM_IDENTITY, { x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });

  it('never zooms out below 1x nor past the maximum', () => {
    const start = startPinch(PINCH_ZOOM_IDENTITY, { x: 100, y: 100 }, { x: 200, y: 100 });
    if (!start) throw new Error('pinch did not start');
    expect(pinchPanZoom(start, { x: 140, y: 100 }, { x: 160, y: 100 }, SIZE)).toEqual(
      PINCH_ZOOM_IDENTITY,
    );
    expect(pinchPanZoom(start, { x: 0, y: 100 }, { x: 400, y: 100 }, SIZE).scale).toBe(
      PINCH_ZOOM_MAX,
    );
  });
});

describe('double tap', () => {
  it('zooms in to the double-tap scale and back out', () => {
    expect(doubleTapScale(1)).toBe(PINCH_ZOOM_DOUBLE_TAP_SCALE);
    expect(doubleTapScale(1.02)).toBe(PINCH_ZOOM_DOUBLE_TAP_SCALE);
    expect(doubleTapScale(1.5)).toBe(1);
    expect(doubleTapScale(PINCH_ZOOM_MAX)).toBe(1);
  });

  it('zooms to the tapped point', () => {
    const tap = { x: 300, y: 80 };
    const state = zoomAbout(PINCH_ZOOM_IDENTITY, tap, doubleTapScale(1), SIZE);
    expect(drawnAt(state, tap)).toEqual(tap);
  });

  it('recognises two nearby, quick taps', () => {
    const first = { x: 100, y: 100, time: 1000 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { x: 110, y: 104, time: 1000 + DOUBLE_TAP_MAX_INTERVAL_MS })).toBe(
      true,
    );
    expect(
      isDoubleTap(first, { x: 100, y: 100, time: 1000 + DOUBLE_TAP_MAX_INTERVAL_MS + 1 }),
    ).toBe(false);
    expect(isDoubleTap(first, { x: 100 + DOUBLE_TAP_MAX_DISTANCE + 1, y: 100, time: 1100 })).toBe(
      false,
    );
  });
});

describe('wheel zoom', () => {
  it('zooms in on negative delta and out on positive delta', () => {
    expect(wheelScaleFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelScaleFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelScaleFactor(0, 0, true)).toBe(1);
  });

  it('is gentler per notch for a mouse wheel than for a trackpad pinch of the same delta', () => {
    expect(Math.abs(Math.log(wheelScaleFactor(-100, 0, false)))).toBeLessThan(
      Math.abs(Math.log(wheelScaleFactor(-100, 0, true))),
    );
  });

  it('treats line deltas as larger movements and caps one event', () => {
    expect(wheelScaleFactor(-3, 1, false)).toBeGreaterThan(wheelScaleFactor(-3, 0, false));
    expect(wheelScaleFactor(-10_000, 0, true)).toBe(wheelScaleFactor(-120, 0, true));
  });
});

describe('scroll compensation', () => {
  it('scrolls by how far the content point drifted from the focal point', () => {
    // Content point (100, 50) was under focal (300, 200); after zooming to 2x the content origin is
    // still at (200, 150), so the point sits at (400, 250): scroll by (100, 50).
    expect(
      scrollDeltaForFocal({ x: 200, y: 150 }, { x: 100, y: 50 }, { x: 300, y: 200 }, 2),
    ).toEqual({ x: 100, y: 50 });
  });

  it('needs no scroll when the origin already compensates', () => {
    expect(
      scrollDeltaForFocal({ x: 100, y: 100 }, { x: 100, y: 50 }, { x: 300, y: 200 }, 2),
    ).toEqual({ x: 0, y: 0 });
  });
});
