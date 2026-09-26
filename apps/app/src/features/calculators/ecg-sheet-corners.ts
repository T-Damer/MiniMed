import type { EcgPhotoCorners } from './ecg-model-contract';

export interface EcgRgbImage {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly height: number;
  readonly width: number;
}

export interface EcgSheetCornerDetection {
  readonly corners: EcgPhotoCorners;
  /** Share of the fitted quadrilateral covered by the detected sheet; near 1 for a clean sheet. */
  readonly fill: number;
}

const DETECTION_EDGE = 512;
const MIN_SHEET_SHARE = 0.2;
const MIN_FILL = 0.85;

function luminance(data: EcgRgbImage['data'], offset: number): number {
  return (
    0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0)
  );
}

/** Box-averaged luminance at no more than DETECTION_EDGE pixels on the long side. */
function downscaledLuminance(image: EcgRgbImage): {
  readonly values: Float32Array;
  readonly width: number;
  readonly height: number;
} {
  const factor = Math.max(1, Math.ceil(Math.max(image.width, image.height) / DETECTION_EDGE));
  const width = Math.max(1, Math.floor(image.width / factor));
  const height = Math.max(1, Math.floor(image.height / factor));
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          sum += luminance(image.data, ((y * factor + dy) * image.width + x * factor + dx) * 3);
        }
      }
      values[y * width + x] = sum / (factor * factor);
    }
  }
  return { values, width, height };
}

function otsuThreshold(values: Float32Array): number {
  const histogram = new Float64Array(256);
  for (const value of values) {
    const level = Math.max(0, Math.min(255, Math.round(value)));
    histogram[level] = (histogram[level] ?? 0) + 1;
  }
  const total = values.length;
  let sumAll = 0;
  for (let level = 0; level < 256; level += 1) sumAll += level * (histogram[level] ?? 0);
  let background = 0;
  let sumBackground = 0;
  let best = 0;
  let threshold = 128;
  for (let level = 0; level < 256; level += 1) {
    background += histogram[level] ?? 0;
    if (background === 0 || background === total) continue;
    sumBackground += level * (histogram[level] ?? 0);
    const meanBackground = sumBackground / background;
    const meanForeground = (sumAll - sumBackground) / (total - background);
    const between = background * (total - background) * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = level;
    }
  }
  return threshold;
}

/** Closes thin dark grid lines and trace strokes so the sheet stays one bright region. */
function closeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dilate = (source: Uint8Array, value: 0 | 1): Uint8Array => {
    const output = new Uint8Array(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let hit = false;
        for (let dy = -radius; dy <= radius && !hit; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -radius; dx <= radius; dx += 1) {
            const xx = x + dx;
            if (xx >= 0 && xx < width && source[yy * width + xx] === value) {
              hit = true;
              break;
            }
          }
        }
        output[y * width + x] = hit === (value === 1) ? 1 : 0;
      }
    }
    return output;
  };
  return dilate(dilate(mask, 1), 0);
}

function largestComponent(
  mask: Uint8Array,
  width: number,
  height: number,
): { readonly pixels: Int32Array; readonly count: number } {
  const labels = new Int32Array(mask.length).fill(-1);
  const queue = new Int32Array(mask.length);
  let best: Int32Array = new Int32Array(0);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || labels[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = start;
    while (head < tail) {
      const index = queue[head++] ?? 0;
      const x = index % width;
      const y = (index - x) / width;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && mask[next] === 1 && labels[next] === -1) {
          labels[next] = start;
          queue[tail++] = next;
        }
      }
    }
    if (tail > best.length) best = queue.slice(0, tail);
  }
  return { pixels: best, count: best.length };
}

function quadArea(corners: EcgPhotoCorners, width: number, height: number): number {
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    if (!point || !next) continue;
    sum += point.x * width * (next.y * height) - next.x * width * (point.y * height);
  }
  return Math.abs(sum) / 2;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Line {
  /** Unit normal and offset: normal · p = offset. */
  readonly nx: number;
  readonly ny: number;
  readonly offset: number;
}

/** Total-least-squares line through points, refitted once without outliers. */
function fitLine(points: readonly Point[]): Line | undefined {
  const fit = (subset: readonly Point[]): Line | undefined => {
    if (subset.length < 4) return undefined;
    const mx = subset.reduce((sum, p) => sum + p.x, 0) / subset.length;
    const my = subset.reduce((sum, p) => sum + p.y, 0) / subset.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of subset) {
      sxx += (p.x - mx) ** 2;
      sxy += (p.x - mx) * (p.y - my);
      syy += (p.y - my) ** 2;
    }
    // The normal is the eigenvector of the smaller eigenvalue of the scatter matrix.
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return { nx, ny, offset: nx * mx + ny * my };
  };
  const first = fit(points);
  if (!first) return undefined;
  const distances = points.map((p) => Math.abs(first.nx * p.x + first.ny * p.y - first.offset));
  const sorted = [...distances].sort((a, b) => a - b);
  const limit = Math.max(1.5, 3 * (sorted[Math.floor(sorted.length / 2)] ?? 0));
  return fit(points.filter((_, index) => (distances[index] ?? Infinity) <= limit)) ?? first;
}

function intersect(a: Line, b: Line): Point | undefined {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-9) return undefined;
  return {
    x: (a.offset * b.ny - a.ny * b.offset) / det,
    y: (a.nx * b.offset - a.offset * b.nx) / det,
  };
}

/**
 * Refines one coarse side at full resolution: along its outward normal, the first dark→bright
 * crossing seen from outside is the paper edge (grid lines inside the sheet are never reached).
 */
function sideEdgePoints(
  image: EcgRgbImage,
  from: Point,
  to: Point,
  inside: Point,
  threshold: number,
): readonly Point[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 8) return [];
  const tx = (to.x - from.x) / length;
  const ty = (to.y - from.y) / length;
  let nx = -ty;
  let ny = tx;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (nx * (inside.x - mid.x) + ny * (inside.y - mid.y) > 0) {
    nx = -nx;
    ny = -ny;
  }
  const reach = Math.max(6, Math.max(image.width, image.height) * 0.025);
  const lum = (x: number, y: number): number | undefined => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return undefined;
    return luminance(image.data, (py * image.width + px) * 3);
  };
  const points: Point[] = [];
  const samples = 48;
  for (let index = 0; index < samples; index += 1) {
    const t = 0.08 + (0.84 * index) / (samples - 1);
    const base = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    let previous: number | undefined;
    for (let step = reach; step >= -reach; step -= 0.5) {
      const value = lum(base.x + nx * step, base.y + ny * step);
      if (value === undefined) {
        previous = undefined;
        continue;
      }
      if (previous !== undefined && previous <= threshold && value > threshold) {
        const fraction = (threshold - previous) / (value - previous);
        const offset = step + 0.5 - 0.5 * fraction;
        points.push({ x: base.x + nx * offset, y: base.y + ny * offset });
        break;
      }
      previous = value;
    }
  }
  return points;
}

function refineCorners(
  image: EcgRgbImage,
  coarse: EcgPhotoCorners,
  threshold: number,
): EcgPhotoCorners | undefined {
  const toPixels = (point: Point): Point => ({
    x: point.x * image.width,
    y: point.y * image.height,
  });
  const quad = [coarse.topLeft, coarse.topRight, coarse.bottomRight, coarse.bottomLeft].map(
    toPixels,
  );
  const centre = {
    x: quad.reduce((sum, p) => sum + p.x, 0) / 4,
    y: quad.reduce((sum, p) => sum + p.y, 0) / 4,
  };
  const lines: Line[] = [];
  for (let side = 0; side < 4; side += 1) {
    const from = quad[side];
    const to = quad[(side + 1) % 4];
    if (!from || !to) return undefined;
    const line = fitLine(sideEdgePoints(image, from, to, centre, threshold));
    if (!line) return undefined;
    lines.push(line);
  }
  const [top, right, bottom, left] = lines;
  if (!top || !right || !bottom || !left) return undefined;
  const corners = [
    intersect(left, top),
    intersect(top, right),
    intersect(right, bottom),
    intersect(bottom, left),
  ];
  const refined = corners.map((point, index) => {
    const fallback = quad[index];
    // A refined corner may not wander far from the coarse one; otherwise keep the coarse corner.
    if (
      !point ||
      !fallback ||
      Math.hypot(point.x - fallback.x, point.y - fallback.y) >
        0.03 * Math.max(image.width, image.height)
    )
      return fallback;
    return point;
  });
  const [tl, tr, br, bl] = refined;
  if (!tl || !tr || !br || !bl) return undefined;
  const normalize = (point: Point) => ({
    x: Math.max(0, Math.min(1, point.x / image.width)),
    y: Math.max(0, Math.min(1, point.y / image.height)),
  });
  return {
    topLeft: normalize(tl),
    topRight: normalize(tr),
    bottomRight: normalize(br),
    bottomLeft: normalize(bl),
  };
}

/**
 * Finds the four corners of the paper sheet: the largest bright region after closing grid lines,
 * reduced to the extreme points of x±y. Returns nothing when the sheet is small, fills the frame
 * without a visible border, or does not look like a quadrilateral — the clinician then drags the
 * corners manually instead of receiving a guess.
 */
export function detectEcgSheetCorners(image: EcgRgbImage): EcgSheetCornerDetection | undefined {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 16 ||
    image.height < 16 ||
    image.data.length !== image.width * image.height * 3
  )
    return undefined;
  const { values, width, height } = downscaledLuminance(image);
  const threshold = otsuThreshold(values);
  const bright = Uint8Array.from(values, (value) => (value > threshold ? 1 : 0));
  const closed = closeMask(
    bright,
    width,
    height,
    Math.max(1, Math.round(Math.max(width, height) / 170)),
  );
  const component = largestComponent(closed, width, height);
  if (component.count < width * height * MIN_SHEET_SHARE) return undefined;

  let topLeft = { score: Infinity, x: 0, y: 0 };
  let bottomRight = { score: -Infinity, x: 0, y: 0 };
  let topRight = { score: -Infinity, x: 0, y: 0 };
  let bottomLeft = { score: Infinity, x: 0, y: 0 };
  let touchesAllBorders = 0b0000;
  for (const index of component.pixels) {
    const x = index % width;
    const y = (index - x) / width;
    if (x === 0) touchesAllBorders |= 0b0001;
    if (x === width - 1) touchesAllBorders |= 0b0010;
    if (y === 0) touchesAllBorders |= 0b0100;
    if (y === height - 1) touchesAllBorders |= 0b1000;
    const sum = x + y;
    const difference = x - y;
    if (sum < topLeft.score) topLeft = { score: sum, x, y };
    if (sum > bottomRight.score) bottomRight = { score: sum, x, y };
    if (difference > topRight.score) topRight = { score: difference, x, y };
    if (difference < bottomLeft.score) bottomLeft = { score: difference, x, y };
  }
  // A bright region touching every edge is a table or a cropped sheet: its corners are unknown.
  if (touchesAllBorders === 0b1111) return undefined;
  const normalize = (point: { x: number; y: number }) => ({
    x: (point.x + 0.5) / width,
    y: (point.y + 0.5) / height,
  });
  const corners: EcgPhotoCorners = {
    topLeft: normalize(topLeft),
    topRight: normalize(topRight),
    bottomRight: normalize(bottomRight),
    bottomLeft: normalize(bottomLeft),
  };
  const area = quadArea(corners, width, height);
  const fill = area > 0 ? Math.min(1, component.count / area) : 0;
  if (fill < MIN_FILL || area < width * height * MIN_SHEET_SHARE) return undefined;
  return { corners: refineCorners(image, corners, threshold) ?? corners, fill };
}
