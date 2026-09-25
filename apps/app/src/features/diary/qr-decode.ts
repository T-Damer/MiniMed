import jsQR from 'jsqr';

/** Decodes one QR code from RGBA pixels; returns null when none is readable. */
export function decodeQrPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  // Phone screens are usually dark-on-light, but inverted themes exist.
  const result = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' });
  return result?.data ?? null;
}

const MAX_DECODE_SIDE = 1280;

/** Draws a video frame or image into a bounded canvas and decodes it. */
export function decodeQrFromSource(
  source: CanvasImageSource & { readonly width?: number; readonly height?: number },
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
): string | null {
  if (sourceWidth === 0 || sourceHeight === 0) return null;
  const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Не удалось подготовить изображение для распознавания кода.');
  context.drawImage(source, 0, 0, width, height);
  return decodeQrPixels(context.getImageData(0, 0, width, height).data, width, height);
}
