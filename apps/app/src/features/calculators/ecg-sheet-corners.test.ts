import { describe, expect, it } from 'vitest';
import type { EcgNormalizedPoint, EcgPhotoCorners } from './ecg-model-contract';
import { rectifyEcgPhotoRgb } from './ecg-photo-rectification';
import { detectEcgSheetCorners, type EcgRgbImage } from './ecg-sheet-corners';

const SHEET_MM = { width: 150, height: 100 } as const;
const PHOTO = { width: 900, height: 700 } as const;
// A phone held at an angle: rotated, with the far (top) edge foreshortened.
const PHOTO_QUAD = [
  { x: 170, y: 90 },
  { x: 760, y: 140 },
  { x: 820, y: 640 },
  { x: 90, y: 600 },
] as const;

type Matrix = readonly [number, number, number, number, number, number, number, number, number];

/** Homography mapping the unit square (TL, TR, BR, BL) onto a quadrilateral. */
function squareToQuad(quad: readonly EcgNormalizedPoint[]): Matrix {
  const [p0, p1, p2, p3] = quad;
  if (!p0 || !p1 || !p2 || !p3) throw new Error('quad');
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const d = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / d;
  const h = (dx1 * dy3 - dx3 * dy1) / d;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/** Paper colour at a sheet position in millimetres: 1 mm minor and 5 mm major red grid. */
function paper(xMm: number, yMm: number): readonly [number, number, number] {
  const near = (value: number, step: number) =>
    Math.abs(value / step - Math.round(value / step)) * step;
  if (near(xMm, 5) < 0.15 || near(yMm, 5) < 0.15) return [200, 70, 70];
  if (near(xMm, 1) < 0.08 || near(yMm, 1) < 0.08) return [240, 175, 175];
  return [250, 247, 242];
}

function renderSkewedPhoto(): EcgRgbImage {
  const toPhoto = squareToQuad(PHOTO_QUAD);
  const toSheet = invert(toPhoto);
  const data = new Uint8Array(PHOTO.width * PHOTO.height * 3);
  for (let y = 0; y < PHOTO.height; y += 1) {
    for (let x = 0; x < PHOTO.width; x += 1) {
      const colour = [0, 0, 0];
      for (const [sx, sy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ] as const) {
        const uv = apply(toSheet, x + sx, y + sy);
        const sample =
          uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1
            ? paper(uv.x * SHEET_MM.width, uv.y * SHEET_MM.height)
            : ([70, 72, 78] as const);
        for (let channel = 0; channel < 3; channel += 1)
          colour[channel] = (colour[channel] ?? 0) + (sample[channel] ?? 0) / 4;
      }
      data.set(colour.map(Math.round), (y * PHOTO.width + x) * 3);
    }
  }
  return { data, width: PHOTO.width, height: PHOTO.height };
}

/**
 * 5 mm grid period (px) along one axis inside a band: autocorrelation of the darkness profile,
 * refined to sub-pixel by a parabola through the peak. Robust to line blur on the stretched far edge.
 */
function bandPeriod(
  image: EcgRgbImage,
  axis: 'x' | 'y',
  band: readonly [number, number],
  expected: number,
): number {
  const length = axis === 'x' ? image.width : image.height;
  const across = axis === 'x' ? image.height : image.width;
  const from = Math.floor(across * band[0]);
  const to = Math.ceil(across * band[1]);
  const profile = new Float64Array(length);
  for (let along = 0; along < length; along += 1) {
    for (let other = from; other < to; other += 1) {
      const x = axis === 'x' ? along : other;
      const y = axis === 'x' ? other : along;
      const offset = (y * image.width + x) * 3;
      const lum =
        0.299 * (image.data[offset] ?? 0) +
        0.587 * (image.data[offset + 1] ?? 0) +
        0.114 * (image.data[offset + 2] ?? 0);
      profile[along] = (profile[along] ?? 0) + (255 - lum);
    }
  }
  const mean = profile.reduce((sum, value) => sum + value, 0) / length;
  const centred = Float64Array.from(profile, (value) => value - mean);
  const correlation = (lag: number) => {
    let sum = 0;
    for (let index = lag; index < length; index += 1)
      sum += (centred[index] ?? 0) * (centred[index - lag] ?? 0);
    return sum / (length - lag);
  };
  const low = Math.floor(expected * 0.8);
  const high = Math.ceil(expected * 1.2);
  let best = low;
  for (let lag = low; lag <= high; lag += 1) if (correlation(lag) > correlation(best)) best = lag;
  const left = correlation(best - 1);
  const centre = correlation(best);
  const right = correlation(best + 1);
  return best + (0.5 * (left - right)) / (left - 2 * centre + right);
}

function cornerError(found: EcgPhotoCorners): number {
  const expected = PHOTO_QUAD.map((point) => ({
    x: point.x / PHOTO.width,
    y: point.y / PHOTO.height,
  }));
  const actual = [found.topLeft, found.topRight, found.bottomRight, found.bottomLeft];
  return Math.max(
    ...actual.map((point, index) =>
      Math.hypot(
        (point.x - (expected[index]?.x ?? 0)) * PHOTO.width,
        (point.y - (expected[index]?.y ?? 0)) * PHOTO.height,
      ),
    ),
  );
}

describe('automatic sheet corners and perspective rectification', () => {
  const photo = renderSkewedPhoto();
  const detection = detectEcgSheetCorners(photo);

  it('finds the four sheet corners of a skewed photo within a few pixels', () => {
    expect(detection).toBeDefined();
    expect(cornerError(detection?.corners as EcgPhotoCorners)).toBeLessThan(2.5);
    expect(detection?.fill).toBeGreaterThan(0.97);
  });

  it('restores a uniform grid: spacing error measured on both axes', () => {
    const rectified = rectifyEcgPhotoRgb(photo, detection?.corners as EcgPhotoCorners);
    // True 5 mm period of the rectified image, which spans the sheet edge to edge.
    const expectedX = (rectified.width / SHEET_MM.width) * 5;
    const expectedY = (rectified.height / SHEET_MM.height) * 5;
    const period = {
      x: bandPeriod(rectified, 'x', [0.05, 0.95], expectedX),
      y: bandPeriod(rectified, 'y', [0.05, 0.95], expectedY),
      xFar: bandPeriod(rectified, 'x', [0.02, 0.2], expectedX),
      xNear: bandPeriod(rectified, 'x', [0.8, 0.98], expectedX),
      yLeft: bandPeriod(rectified, 'y', [0.02, 0.2], expectedY),
      yRight: bandPeriod(rectified, 'y', [0.8, 0.98], expectedY),
    };
    const error = {
      x: Math.abs(period.x - expectedX) / expectedX,
      y: Math.abs(period.y - expectedY) / expectedY,
      farVsNear: Math.abs(period.xFar - period.xNear) / expectedX,
      leftVsRight: Math.abs(period.yLeft - period.yRight) / expectedY,
    };
    console.info(
      'rectified 5 mm grid error, %',
      Object.fromEntries(
        Object.entries(error).map(([key, value]) => [key, (value * 100).toFixed(2)]),
      ),
    );
    expect(error.x).toBeLessThan(0.01);
    expect(error.y).toBeLessThan(0.01);
    expect(error.farVsNear).toBeLessThan(0.01);
    expect(error.leftVsRight).toBeLessThan(0.01);
  });

  it('shows why rectification is needed: the raw photo has a non-uniform grid', () => {
    const far = bandPeriod(photo, 'x', [0.16, 0.2], 21);
    const near = bandPeriod(photo, 'x', [0.8, 0.84], 25);
    expect(Math.abs(far - near) / near).toBeGreaterThan(0.05);
  });

  it('abstains when no sheet border is visible', () => {
    const blank = {
      data: new Uint8Array(200 * 150 * 3).fill(245),
      width: 200,
      height: 150,
    };
    expect(detectEcgSheetCorners(blank)).toBeUndefined();
  });
});
