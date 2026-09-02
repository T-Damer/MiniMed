import { scaleThumbnailSize } from '@/state/note-images';
import type { loadPdfJsDocument } from '@/state/pdfjs-document';
import { isUserLibraryDicomFile, isUserLibraryVolumeFile } from '@/state/user-library';
import { readZipEntry } from '@/state/user-library-zip';

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
async function embeddedImageThumbnail(blob: Blob): Promise<string | undefined> {
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

function joinZipPath(base: string, relative: string): string {
  const baseParts = base.includes('/') ? base.split('/').slice(0, -1) : [];
  const parts = [...baseParts];
  for (const segment of relative.replace(/^\//u, '').split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

async function epubThumbnail(blob: Blob): Promise<string | undefined> {
  try {
    const data = await blob.arrayBuffer();
    const containerBytes = await readZipEntry(data, 'META-INF/container.xml');
    if (!containerBytes) return undefined;
    const container = new DOMParser().parseFromString(
      new TextDecoder().decode(containerBytes),
      'application/xml',
    );
    const rootfile = container.querySelector('rootfile');
    const opfPath = rootfile?.getAttribute('full-path') ?? rootfile?.getAttribute('fullPath');
    if (!opfPath) return undefined;
    const opfBytes = await readZipEntry(data, opfPath);
    if (!opfBytes) return undefined;
    const opf = new DOMParser().parseFromString(
      new TextDecoder().decode(opfBytes),
      'application/xml',
    );
    const items = Array.from(opf.getElementsByTagName('item'));
    const coverId = Array.from(opf.getElementsByTagName('meta'))
      .find((item) => item.getAttribute('name')?.toLowerCase() === 'cover')
      ?.getAttribute('content');
    const cover =
      items.find((item) =>
        item.getAttribute('properties')?.split(/\s+/u).includes('cover-image'),
      ) ??
      items.find((item) => item.getAttribute('id') === coverId) ??
      items.find(
        (item) =>
          item.getAttribute('media-type')?.startsWith('image/') &&
          /cover|front/iu.test(
            `${item.getAttribute('id') ?? ''} ${item.getAttribute('href') ?? ''}`,
          ),
      ) ??
      items.find((item) => item.getAttribute('media-type')?.startsWith('image/'));
    if (!cover) return undefined;
    const href = cover.getAttribute('href');
    if (!href) return undefined;
    const coverBytes = await readZipEntry(data, joinZipPath(opfPath, decodeURIComponent(href)));
    if (!coverBytes) return undefined;
    const coverData = new ArrayBuffer(coverBytes.byteLength);
    new Uint8Array(coverData).set(coverBytes);
    return await rasterImageThumbnail(
      new Blob([coverData], { type: cover.getAttribute('media-type') ?? 'image/jpeg' }),
    );
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
  let pdfDocument: Awaited<ReturnType<typeof loadPdfJsDocument>> | undefined;
  try {
    const { loadPdfJsDocument } = await import('@/state/pdfjs-document');
    pdfDocument = await loadPdfJsDocument(blob);
    const page = await pdfDocument.getPage(1);
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
  } finally {
    await pdfDocument?.destroy();
  }
}

/**
 * Single entry point that turns any attachable file into a small preview
 * image: photos and screenshots directly, videos via a captured frame,
 * PDFs via their first page, EPUBs via their cover, and HEIC/HEIF or audio
 * files via an embedded JPEG thumbnail when the browser cannot decode them.
 */
export class AttachmentThumbnails {
  async forFile(file: File | Blob, mimeType: string, name?: string): Promise<string | undefined> {
    const lowerName = (name ?? '').toLowerCase();
    if (isUserLibraryDicomFile(mimeType, lowerName)) {
      const { createDicomThumbnail } = await import('@/features/library/dicom-thumbnail');
      return await createDicomThumbnail(file);
    }
    if (isUserLibraryVolumeFile(mimeType, lowerName)) {
      const { createVolumeThumbnail } = await import('@/features/library/volume-thumbnail');
      return await createVolumeThumbnail(file, name ?? 'volume.nii');
    }
    const isHeic =
      mimeType === 'image/heic' ||
      mimeType === 'image/heif' ||
      lowerName.endsWith('.heic') ||
      lowerName.endsWith('.heif');
    if (isHeic) return (await rasterImageThumbnail(file)) ?? (await embeddedImageThumbnail(file));
    if (mimeType.startsWith('image/')) return await rasterImageThumbnail(file);
    if (mimeType.startsWith('video/') || /\.(?:avi|mkv|mov|mp4|webm)$/u.test(lowerName)) {
      return await videoThumbnail(file);
    }
    if (mimeType === 'application/pdf') return await pdfThumbnail(file);
    if (mimeType === 'application/epub+zip' || lowerName.endsWith('.epub')) {
      return await epubThumbnail(file);
    }
    if (mimeType.startsWith('audio/') || /\.(?:flac|m4a|mp3|ogg|wav)$/u.test(lowerName)) {
      return await embeddedImageThumbnail(file);
    }
    return undefined;
  }
}

export const attachmentThumbnails = new AttachmentThumbnails();
export const previewExtractor = attachmentThumbnails;
export const thumbnailExtractor = attachmentThumbnails;

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
