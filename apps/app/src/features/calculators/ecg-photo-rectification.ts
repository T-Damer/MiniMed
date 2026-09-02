import type {
  EcgNormalizedPoint,
  EcgPhotoCorners,
} from '@/features/calculators/ecg-model-contract';

interface RgbImage {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly height: number;
  readonly width: number;
}

export interface RectifiedEcgPhotoPreview {
  readonly blob: Blob;
  readonly height: number;
  readonly width: number;
}

const MAX_OUTPUT_EDGE = 2048;

function cross(origin: EcgNormalizedPoint, left: EcgNormalizedPoint, right: EcgNormalizedPoint) {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

function validateCorners(corners: EcgPhotoCorners): readonly EcgNormalizedPoint[] {
  const points = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ] as const;
  if (
    points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1,
    )
  ) {
    throw new Error('Углы листа должны находиться внутри изображения.');
  }
  const turns = points.map((point, index) =>
    cross(point, points[(index + 1) % 4] ?? point, points[(index + 2) % 4] ?? point),
  );
  if (turns.some((turn) => turn <= 0)) {
    throw new Error('Углы листа должны образовывать выпуклый контур по часовой стрелке.');
  }
  const area = Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % 4] ?? point;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
  if (area < 0.05) throw new Error('Выбранная область листа слишком мала.');
  return points;
}

function distance(
  left: EcgNormalizedPoint,
  right: EcgNormalizedPoint,
  width: number,
  height: number,
) {
  return Math.hypot((right.x - left.x) * width, (right.y - left.y) * height);
}

export function rectifyEcgPhotoRgb(image: RgbImage, corners: EcgPhotoCorners): RgbImage {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 2 ||
    image.height < 2 ||
    image.data.length !== image.width * image.height * 3
  ) {
    throw new Error('Не удалось прочитать RGB-изображение ЭКГ.');
  }
  const [topLeft, topRight, bottomRight, bottomLeft] = validateCorners(corners);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
    throw new Error('Не заданы четыре угла листа.');
  }
  const rawWidth = Math.max(
    distance(topLeft, topRight, image.width, image.height),
    distance(bottomLeft, bottomRight, image.width, image.height),
  );
  const rawHeight = Math.max(
    distance(topLeft, bottomLeft, image.width, image.height),
    distance(topRight, bottomRight, image.width, image.height),
  );
  const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(rawWidth, rawHeight));
  const width = Math.max(2, Math.round(rawWidth * scale));
  const height = Math.max(2, Math.round(rawHeight * scale));
  const sourcePoints = [topLeft, topRight, bottomRight, bottomLeft].map((point) => ({
    x: point.x * (image.width - 1),
    y: point.y * (image.height - 1),
  }));
  const [p0, p1, p2, p3] = sourcePoints;
  if (!p0 || !p1 || !p2 || !p3) throw new Error('Не заданы четыре угла листа.');
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(denominator) < 1e-9) throw new Error('Не удалось выпрямить выбранный контур.');
  const projectiveX = (dx3 * dy2 - dx2 * dy3) / denominator;
  const projectiveY = (dx1 * dy3 - dx3 * dy1) / denominator;
  const matrix = [
    p1.x - p0.x + projectiveX * p1.x,
    p3.x - p0.x + projectiveY * p3.x,
    p0.x,
    p1.y - p0.y + projectiveX * p1.y,
    p3.y - p0.y + projectiveY * p3.y,
    p0.y,
    projectiveX,
    projectiveY,
  ] as const;
  const output = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const v = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / Math.max(1, width - 1);
      const divisor = matrix[6] * u + matrix[7] * v + 1;
      const sourceX = Math.max(
        0,
        Math.min(image.width - 1, (matrix[0] * u + matrix[1] * v + matrix[2]) / divisor),
      );
      const sourceY = Math.max(
        0,
        Math.min(image.height - 1, (matrix[3] * u + matrix[4] * v + matrix[5]) / divisor),
      );
      const left = Math.floor(sourceX);
      const top = Math.floor(sourceY);
      const right = Math.min(image.width - 1, left + 1);
      const bottom = Math.min(image.height - 1, top + 1);
      const horizontal = sourceX - left;
      const vertical = sourceY - top;
      for (let channel = 0; channel < 3; channel += 1) {
        const topLeftValue = image.data[(top * image.width + left) * 3 + channel] ?? 0;
        const topRightValue = image.data[(top * image.width + right) * 3 + channel] ?? 0;
        const bottomLeftValue = image.data[(bottom * image.width + left) * 3 + channel] ?? 0;
        const bottomRightValue = image.data[(bottom * image.width + right) * 3 + channel] ?? 0;
        const topValue = topLeftValue + (topRightValue - topLeftValue) * horizontal;
        const bottomValue = bottomLeftValue + (bottomRightValue - bottomLeftValue) * horizontal;
        output[(y * width + x) * 3 + channel] = Math.round(
          topValue + (bottomValue - topValue) * vertical,
        );
      }
    }
  }
  return { data: output, height, width };
}

export async function createRectifiedEcgPhotoPreview(
  file: Blob,
  corners: EcgPhotoCorners,
): Promise<RectifiedEcgPhotoPreview> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(bitmap.width, bitmap.height));
  const sourceWidth = Math.max(2, Math.round(bitmap.width * scale));
  const sourceHeight = Math.max(2, Math.round(bitmap.height * scale));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) {
    bitmap.close();
    throw new Error('Не удалось подготовить выправленный вид ЭКГ.');
  }
  sourceContext.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
  bitmap.close();
  const rgba = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
  const rgb = new Uint8Array(sourceWidth * sourceHeight * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source] ?? 0;
    rgb[target + 1] = rgba[source + 1] ?? 0;
    rgb[target + 2] = rgba[source + 2] ?? 0;
  }
  const rectified = rectifyEcgPhotoRgb(
    { data: rgb, height: sourceHeight, width: sourceWidth },
    corners,
  );
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = rectified.width;
  outputCanvas.height = rectified.height;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('Не удалось показать выправленный вид ЭКГ.');
  const output = outputContext.createImageData(rectified.width, rectified.height);
  for (let source = 0, target = 0; source < rectified.data.length; source += 3, target += 4) {
    output.data[target] = rectified.data[source] ?? 0;
    output.data[target + 1] = rectified.data[source + 1] ?? 0;
    output.data[target + 2] = rectified.data[source + 2] ?? 0;
    output.data[target + 3] = 255;
  }
  outputContext.putImageData(output, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error('Не удалось сохранить выправленный вид.')),
      'image/jpeg',
      0.9,
    );
  });
  return { blob, height: rectified.height, width: rectified.width };
}
