/**
 * PDF zoom as a factor of the column width: 1 is «по ширине» (the page fills the reader column),
 * below 1 shows several pages' worth in less space, above 1 scrolls sideways. Same stops as the
 * Chromium viewer.
 */

export const PDF_ZOOM_MIN = 0.5;
export const PDF_ZOOM_MAX = 4;
export const PDF_ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function clampPdfZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, value));
}

/** The next stop above (`1`) or below (`-1`) the current zoom. */
export function stepPdfZoom(current: number, direction: 1 | -1): number {
  const epsilon = 0.001;
  if (direction === 1) {
    return PDF_ZOOM_LEVELS.find((level) => level > current + epsilon) ?? PDF_ZOOM_MAX;
  }
  return PDF_ZOOM_LEVELS.toReversed().find((level) => level < current - epsilon) ?? PDF_ZOOM_MIN;
}

/**
 * Zoom at which a whole page fits the visible height: page width `columnWidth` and aspect ratio
 * `width / height` give a page of `columnWidth / aspect` height at zoom 1. A page that already fits
 * stays at 1.
 */
export function fitPageZoom(
  visibleHeight: number,
  columnWidth: number,
  pageAspect: number,
): number {
  if (visibleHeight <= 0 || columnWidth <= 0 || pageAspect <= 0) return 1;
  const pageHeightAtFitWidth = columnWidth / pageAspect;
  return clampPdfZoom(Math.min(1, visibleHeight / pageHeightAtFitWidth));
}

/** Ctrl/⌘ + wheel (and trackpad pinch, which Chromium reports as ctrl+wheel). */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.01);
}

export function formatPdfZoom(zoom: number): string {
  return `${String(Math.round(zoom * 100))}%`;
}
