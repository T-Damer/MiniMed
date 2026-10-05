import { describe, expect, it } from 'vitest';

import {
  clampPdfZoom,
  fitPageZoom,
  formatPdfZoom,
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  stepPdfZoom,
  wheelZoomFactor,
} from './pdf-zoom';

describe('PDF zoom', () => {
  it('steps through the stops from any zoom and stops at the ends', () => {
    expect(stepPdfZoom(1, 1)).toBe(1.25);
    expect(stepPdfZoom(1, -1)).toBe(0.75);
    expect(stepPdfZoom(1.1, 1)).toBe(1.25);
    expect(stepPdfZoom(1.1, -1)).toBe(1);
    expect(stepPdfZoom(PDF_ZOOM_MAX, 1)).toBe(PDF_ZOOM_MAX);
    expect(stepPdfZoom(PDF_ZOOM_MIN, -1)).toBe(PDF_ZOOM_MIN);
  });

  it('clamps and tolerates garbage', () => {
    expect(clampPdfZoom(9)).toBe(PDF_ZOOM_MAX);
    expect(clampPdfZoom(0.1)).toBe(PDF_ZOOM_MIN);
    expect(clampPdfZoom(Number.NaN)).toBe(1);
  });

  it('fits a whole page into the visible height, never enlarging past fit-width', () => {
    // A4 portrait (aspect 0.707) in a 400 px column is 566 px tall; 400 px of room → 0.707.
    expect(fitPageZoom(400, 400, 210 / 297)).toBeCloseTo(210 / 297, 3);
    expect(fitPageZoom(2000, 400, 210 / 297)).toBe(1);
    expect(fitPageZoom(0, 400, 210 / 297)).toBe(1);
  });

  it('turns wheel deltas into a smooth factor', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100000)).toBeCloseTo(wheelZoomFactor(-120), 6);
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(1);
  });

  it('formats percent', () => {
    expect(formatPdfZoom(1.25)).toBe('125%');
  });
});
