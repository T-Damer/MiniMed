/** A pull past this distance closes the sheet, however slowly it was made. */
export const SHEET_CLOSE_DISTANCE_PX = 96;
/** A flick this fast closes the sheet even over a short distance (px per ms). */
export const SHEET_CLOSE_VELOCITY = 0.6;

/** How far the sheet follows the finger: only downwards, never above its resting place. */
export function sheetDragOffset(startY: number, currentY: number): number {
  return Math.max(0, currentY - startY);
}

/** Whether releasing a downward drag should close the sheet or let it spring back. */
export function sheetDragShouldClose(offsetPx: number, elapsedMs: number): boolean {
  if (offsetPx >= SHEET_CLOSE_DISTANCE_PX) return true;
  if (offsetPx < 12 || elapsedMs <= 0) return false;
  return offsetPx / elapsedMs >= SHEET_CLOSE_VELOCITY;
}
