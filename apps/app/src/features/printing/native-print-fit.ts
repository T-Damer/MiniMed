/** Fit unscaled content inside an A4 preview sheet; never upscale above 1. */
export function computePrintFitScale(
  contentWidth: number,
  contentHeight: number,
  sheetWidth: number,
  sheetHeight: number,
): number {
  if (
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(contentHeight) ||
    !Number.isFinite(sheetWidth) ||
    !Number.isFinite(sheetHeight) ||
    contentWidth <= 0 ||
    contentHeight <= 0 ||
    sheetWidth <= 0 ||
    sheetHeight <= 0
  ) {
    return 1;
  }
  const widthScale = sheetWidth / contentWidth;
  const heightScale = sheetHeight / contentHeight;
  return Math.min(1, widthScale, heightScale);
}

/** Content this many sheets tall or more reads as a document, not a one-page form. */
const FLOW_PAGES = 1.35;

/**
 * How the phone preview lays a printout out. A one-page form shrinks to fit its sheet; a document
 * of several pages (a drug instruction, a long result) fits the width and flows down as one long
 * paper. Shrinking a 20-page instruction into one sheet made it a blank white page (owner
 * 2026-11-06).
 */
export function computePrintPreviewLayout(
  contentWidth: number,
  contentHeight: number,
  sheetWidth: number,
  sheetHeight: number,
): { readonly scale: number; readonly flow: boolean } {
  const widthScale =
    Number.isFinite(contentWidth) && contentWidth > 0 && sheetWidth > 0
      ? Math.min(1, sheetWidth / contentWidth)
      : 1;
  const flow =
    Number.isFinite(contentHeight) &&
    sheetHeight > 0 &&
    contentHeight * widthScale > sheetHeight * FLOW_PAGES;
  return flow
    ? { scale: widthScale, flow }
    : { scale: computePrintFitScale(contentWidth, contentHeight, sheetWidth, sheetHeight), flow };
}
