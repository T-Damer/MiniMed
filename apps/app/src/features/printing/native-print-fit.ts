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
