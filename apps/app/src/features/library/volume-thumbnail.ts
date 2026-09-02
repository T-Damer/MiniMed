import { Niivue } from '@niivue/niivue';

import { withViewerTimeout } from '@/features/library/medical-image-utils';

let thumbnailQueue = Promise.resolve<string | undefined>(undefined);

async function renderVolumeThumbnail(blob: Blob, name: string): Promise<string | undefined> {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  canvas.className = 'medical-image-thumbnail-canvas';
  document.body.append(canvas);
  const viewer = new Niivue({
    backColor: [0.02, 0.025, 0.03, 1],
    dragAndDropEnabled: false,
    forceDevicePixelRatio: -1,
    interactive: false,
    isResizeCanvas: false,
    isOrientationTextVisible: false,
  });
  try {
    await viewer.attachToCanvas(canvas, false);
    await withViewerTimeout(
      viewer.loadFromArrayBuffer(await blob.arrayBuffer(), name),
      'Превью volume-файла создаётся слишком долго.',
    );
    viewer.setSliceType(viewer.sliceTypeAxial);
    viewer.drawScene();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return canvas.toDataURL('image/jpeg', 0.76);
  } catch {
    return undefined;
  } finally {
    viewer.cleanup();
    canvas.remove();
  }
}

export function createVolumeThumbnail(blob: Blob, name: string): Promise<string | undefined> {
  const next = thumbnailQueue.then(
    () => renderVolumeThumbnail(blob, name),
    () => renderVolumeThumbnail(blob, name),
  );
  thumbnailQueue = next;
  return next;
}
