import { scaleThumbnailSize } from '@/state/note-images';

const THUMBNAIL_QUALITY = 0.72;
const EMBEDDED_JPEG_SCAN_BYTES = 8 * 1024 * 1024;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Не удалось декодировать изображение.'));
    element.src = src;
  });
}

async function canvasThumbnail(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<string> {
  const scaled = scaleThumbnailSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить миниатюру.');
  context.drawImage(source, 0, 0, scaled.width, scaled.height);
  return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
}

async function rasterImageThumbnail(blob: Blob): Promise<string | undefined> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(url);
    return await canvasThumbnail(image, image.naturalWidth, image.naturalHeight);
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Best-effort scan for an embedded JPEG thumbnail (EXIF/HEIF containers keep a
 * small preview JPEG inside). Returns the decoded thumbnail when found.
 */
async function embeddedJpegThumbnail(blob: Blob): Promise<string | undefined> {
  try {
    const head = new Uint8Array(await blob.slice(0, EMBEDDED_JPEG_SCAN_BYTES).arrayBuffer());
    let start = -1;
    for (let index = 0; index < head.length - 2; index += 1) {
      if (head[index] === 0xff && head[index + 1] === 0xd8 && head[index + 2] === 0xff) {
        start = index;
        break;
      }
    }
    if (start < 0) return undefined;
    let end = -1;
    for (let index = start + 3; index < head.length - 1; index += 1) {
      if (head[index] === 0xff && head[index + 1] === 0xd9) {
        end = index + 2;
        break;
      }
    }
    if (end <= start + 100) return undefined;
    const jpegBlob = blob.slice(start, end, 'image/jpeg');
    return await rasterImageThumbnail(jpegBlob);
  } catch {
    return undefined;
  }
}

async function videoThumbnail(blob: Blob): Promise<string | undefined> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Видео не открылось.')), 8000);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Видео не декодировалось.'));
      };
      video.src = url;
    });
    const target = Math.min(1, (video.duration || 1) * 0.25);
    await new Promise<void>((resolve) => {
      const done = (): void => {
        video.removeEventListener('seeked', done);
        resolve();
      };
      video.addEventListener('seeked', done);
      video.currentTime = Number.isFinite(target) ? target : 0;
      setTimeout(done, 2500);
    });
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    return await canvasThumbnail(video, width, height);
  } catch {
    return undefined;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function pdfThumbnail(blob: Blob): Promise<string | undefined> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const data = await blob.arrayBuffer();
    const document_ = await pdfjs.getDocument({ data }).promise;
    const page = await document_.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1, 360 / Math.max(viewport.width, viewport.height));
    const scaled = page.getViewport({ scale: Math.max(scale, 0.15) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(scaled.width);
    canvas.height = Math.round(scaled.height);
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport: scaled, canvas }).promise;
    void viewport;
    return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
  } catch {
    return undefined;
  }
}

/**
 * Single entry point that turns any attachable file into a small preview
 * image: photos and screenshots directly, videos via a captured frame,
 * PDFs via their first page, HEIC/HEIF via the embedded EXIF thumbnail.
 */
export class AttachmentThumbnails {
  async forFile(file: File | Blob, mimeType: string, name?: string): Promise<string | undefined> {
    const lowerName = (name ?? '').toLowerCase();
    const isHeic =
      mimeType === 'image/heic' ||
      mimeType === 'image/heif' ||
      lowerName.endsWith('.heic') ||
      lowerName.endsWith('.heif');
    if (isHeic) return (await rasterImageThumbnail(file)) ?? (await embeddedJpegThumbnail(file));
    if (mimeType.startsWith('image/')) return await rasterImageThumbnail(file);
    if (mimeType.startsWith('video/')) return await videoThumbnail(file);
    if (mimeType === 'application/pdf') return await pdfThumbnail(file);
    return undefined;
  }
}

export const attachmentThumbnails = new AttachmentThumbnails();

/** Readable-in-app categories used to decide viewer vs. download prompt. */
export type AttachableViewerKind = 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'download';

export function attachmentViewerKind(mimeType: string): AttachableViewerKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/rtf'
  ) {
    return 'text';
  }
  return 'download';
}
