import { type Types as CornerstoneTypes, cache, imageLoader } from '@cornerstonejs/core';
import {
  metaData as dicomMetaData,
  utilities as dicomUtilities,
  Enums as MetadataEnums,
} from '@cornerstonejs/metadata';

import { initializeDicomRuntime } from '@/features/library/dicom-runtime';
import { withViewerTimeout } from '@/features/library/medical-image-utils';

function framesFor(baseImageId: string): readonly string[] {
  const frames = dicomMetaData.getTyped(
    MetadataEnums.MetadataModules.FRAME_IMAGE_IDS,
    baseImageId,
  ) as Set<string> | undefined;
  return frames && frames.size > 0 ? [...frames] : [baseImageId];
}

function thumbnailCanvas(image: CornerstoneTypes.IImage): string | undefined {
  const width = image.width;
  const height = image.height;
  const pixels = image.getPixelData();
  if (!width || !height || !pixels?.length) return undefined;
  const maxEdge = 320;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const frame = context.createImageData(targetWidth, targetHeight);
  const center = Number(
    Array.isArray(image.windowCenter) ? image.windowCenter[0] : image.windowCenter,
  );
  const windowWidth = Number(
    Array.isArray(image.windowWidth) ? image.windowWidth[0] : image.windowWidth,
  );
  const minimum = Number.isFinite(image.minPixelValue) ? image.minPixelValue : 0;
  const maximum = Number.isFinite(image.maxPixelValue) ? image.maxPixelValue : minimum + 1;
  const low = Number.isFinite(center) && windowWidth > 0 ? center - windowWidth / 2 : minimum;
  const high = Number.isFinite(center) && windowWidth > 0 ? center + windowWidth / 2 : maximum;
  const range = Math.max(1, high - low);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const value = Number(pixels[sourceY * width + sourceX]);
      const gray = Math.round(Math.min(255, Math.max(0, ((value - low) / range) * 255)));
      const output = image.invert ? 255 - gray : gray;
      const offset = (y * targetWidth + x) * 4;
      frame.data[offset] = output;
      frame.data[offset + 1] = output;
      frame.data[offset + 2] = output;
      frame.data[offset + 3] = 255;
    }
  }
  context.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.76);
}

export async function createDicomThumbnail(blob: Blob): Promise<string | undefined> {
  await initializeDicomRuntime();
  const baseImageId = `dicomfile:minimed-thumbnail-${crypto.randomUUID()}`;
  let imageId = baseImageId;
  try {
    await dicomUtilities.addDicomPart10Instance(baseImageId, await blob.arrayBuffer());
    imageId = framesFor(baseImageId)[0] ?? baseImageId;
    const image = await withViewerTimeout(
      imageLoader.loadAndCacheImage(imageId),
      'Превью DICOM создаётся слишком долго.',
    );
    return thumbnailCanvas(image);
  } catch {
    return undefined;
  } finally {
    if (cache.getImageLoadObject(imageId)) cache.removeImageLoadObject(imageId, { force: true });
    dicomMetaData.clearQuery(MetadataEnums.MetadataModules.NATURALIZED, baseImageId);
  }
}
