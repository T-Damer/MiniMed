/**
 * The square the model sees. The camera window is 1:1 and shows the centre of the frame (`object-fit:
 * cover`), so a capture and an uploaded photo are cropped the same way: the largest centred square.
 */

export interface SquareCrop {
  readonly sx: number;
  readonly sy: number;
  readonly size: number;
}

export function squareCrop(width: number, height: number): SquareCrop {
  const size = Math.max(1, Math.floor(Math.min(width, height)));
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
  };
}

/** The output side: never upscaled, never above `maxSide`. */
export function outputSide(size: number, maxSide: number): number {
  return Math.max(1, Math.min(size, maxSide));
}

/** What the model receives, what the history keeps, and the grid thumbnail. */
export const SKIN_ANALYSIS_IMAGE = { maxSide: 1024, quality: 0.9 } as const;
export const SKIN_STORED_IMAGE = { maxSide: 720, quality: 0.8 } as const;
export const SKIN_THUMBNAIL_IMAGE = { maxSide: 192, quality: 0.7 } as const;

export type SkinImageSource = ImageBitmap | HTMLVideoElement | HTMLImageElement;

function sourceSize(source: SkinImageSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сохранить снимок.'))),
      'image/jpeg',
      quality,
    );
  });
}

/** The centred square of an image or a video frame as a JPEG. */
export async function squareJpeg(
  source: SkinImageSource,
  image: { readonly maxSide: number; readonly quality: number } = SKIN_ANALYSIS_IMAGE,
): Promise<Blob> {
  const { width, height } = sourceSize(source);
  if (width < 1 || height < 1) throw new Error('Снимок пуст.');
  const crop = squareCrop(width, height);
  const side = outputSide(crop.size, image.maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось обработать снимок.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, crop.sx, crop.sy, crop.size, crop.size, 0, 0, side, side);
  return canvasBlob(canvas, image.quality);
}

/** Decodes a file (EXIF orientation applied) and returns its centred square. */
export async function squareJpegFromBlob(
  file: Blob,
  image: { readonly maxSide: number; readonly quality: number } = SKIN_ANALYSIS_IMAGE,
): Promise<Blob> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      return await squareJpeg(bitmap, image);
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    return await squareJpeg(element, image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface StoredSkinImages {
  readonly photo: Blob;
  readonly thumbnail: Blob;
}

/** The compressed copy a history entry keeps, with its thumbnail. */
export async function storedSkinImages(analysisPhoto: Blob): Promise<StoredSkinImages> {
  const [photo, thumbnail] = await Promise.all([
    squareJpegFromBlob(analysisPhoto, SKIN_STORED_IMAGE),
    squareJpegFromBlob(analysisPhoto, SKIN_THUMBNAIL_IMAGE),
  ]);
  return { photo, thumbnail };
}
