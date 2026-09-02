import type {
  EcgNormalizedRegion,
  EcgPhotoCorners,
  EcgPhotoQualityIssue,
} from '@/features/calculators/ecg-model-contract';

interface EcgPhotoQualityInput {
  readonly corners?: EcgPhotoCorners;
  readonly height: number;
  readonly layout: '3x4+1R' | '12x1';
  readonly rgb: Uint8Array | Uint8ClampedArray;
  readonly width: number;
}

const FULL_IMAGE: EcgNormalizedRegion = { height: 1, width: 1, x: 0, y: 0 };

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function regionFromCorners(corners?: EcgPhotoCorners): EcgNormalizedRegion {
  if (!corners) return FULL_IMAGE;
  const x = Math.min(corners.topLeft.x, corners.bottomLeft.x);
  const right = Math.max(corners.topRight.x, corners.bottomRight.x);
  const y = Math.min(corners.topLeft.y, corners.topRight.y);
  const bottom = Math.max(corners.bottomLeft.y, corners.bottomRight.y);
  return {
    height: clamp(bottom - y),
    width: clamp(right - x),
    x: clamp(x),
    y: clamp(y),
  };
}

function pixelBounds(region: EcgNormalizedRegion, width: number, height: number) {
  const left = Math.max(1, Math.floor(region.x * width));
  const right = Math.min(width - 1, Math.ceil((region.x + region.width) * width));
  const top = Math.max(1, Math.floor(region.y * height));
  const bottom = Math.min(height - 1, Math.ceil((region.y + region.height) * height));
  return { bottom, left, right, top };
}

function channel(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  offset: number,
): number {
  return rgb[(y * width + x) * 3 + offset] ?? 0;
}

function gray(rgb: Uint8Array | Uint8ClampedArray, width: number, x: number, y: number): number {
  return (
    (channel(rgb, width, x, y, 0) + channel(rgb, width, x, y, 1) + channel(rgb, width, x, y, 2)) / 3
  );
}

function isBlurred(input: EcgPhotoQualityInput, region: EcgNormalizedRegion): boolean {
  const { bottom, left, right, top } = pixelBounds(region, input.width, input.height);
  let laplacian = 0;
  let samples = 0;
  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      laplacian += Math.abs(
        gray(input.rgb, input.width, x, y) * 4 -
          gray(input.rgb, input.width, x - 1, y) -
          gray(input.rgb, input.width, x + 1, y) -
          gray(input.rgb, input.width, x, y - 1) -
          gray(input.rgb, input.width, x, y + 1),
      );
      samples += 1;
    }
  }
  return samples > 0 && laplacian / samples < 4;
}

function glareRegion(
  input: EcgPhotoQualityInput,
  region: EcgNormalizedRegion,
): EcgNormalizedRegion | undefined {
  const { bottom, left, right, top } = pixelBounds(region, input.width, input.height);
  const block = Math.max(8, Math.floor(Math.min(right - left, bottom - top) / 24));
  const rows = Math.floor((bottom - top) / block);
  const columns = Math.floor((right - left) / block);
  const redGridRows: boolean[] = [];
  for (let y = top; y < bottom; y += 1) {
    let redGridPixels = 0;
    for (let x = left; x < right; x += 1) {
      const red = channel(input.rgb, input.width, x, y, 0);
      const green = channel(input.rgb, input.width, x, y, 1);
      const blue = channel(input.rgb, input.width, x, y, 2);
      if (red - Math.max(green, blue) > 12) redGridPixels += 1;
    }
    redGridRows.push(redGridPixels / Math.max(1, right - left) >= 0.08);
  }
  let waveformTop = top;
  for (let offset = 0; offset <= redGridRows.length - block; offset += 1) {
    const matchingRows = redGridRows.slice(offset, offset + block).filter(Boolean).length;
    if (matchingRows < block * 0.75) continue;
    waveformTop = top + offset;
    break;
  }
  type BrightBlock = {
    bottom: number;
    column: number;
    left: number;
    right: number;
    row: number;
    top: number;
  };
  const brightBlocks = new Map<string, BrightBlock>();
  for (let row = 0; row < rows; row += 1) {
    const y = top + row * block;
    for (let column = 0; column < columns; column += 1) {
      const x = left + column * block;
      let bright = 0;
      for (let pixelY = y; pixelY < y + block; pixelY += 1) {
        for (let pixelX = x; pixelX < x + block; pixelX += 1) {
          const red = channel(input.rgb, input.width, pixelX, pixelY, 0);
          const green = channel(input.rgb, input.width, pixelX, pixelY, 1);
          const blue = channel(input.rgb, input.width, pixelX, pixelY, 2);
          if (
            (red + green + blue) / 3 >= 248 &&
            Math.max(red, green, blue) - Math.min(red, green, blue) <= 8
          ) {
            bright += 1;
          }
        }
      }
      if (bright / (block * block) >= 0.9) {
        brightBlocks.set(`${row}:${column}`, {
          bottom: y + block,
          column,
          left: x,
          right: x + block,
          row,
          top: y,
        });
      }
    }
  }
  const visited = new Set<string>();
  let selected: BrightBlock[] = [];
  const contextEvidence = (area: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  }): { gridTintRatio: number; structuredRatio: number } => {
    let gridTint = 0;
    let structured = 0;
    let pixels = 0;
    for (let y = area.top; y < area.bottom; y += 1) {
      for (let x = area.left; x < area.right; x += 1) {
        const red = channel(input.rgb, input.width, x, y, 0);
        const green = channel(input.rgb, input.width, x, y, 1);
        const blue = channel(input.rgb, input.width, x, y, 2);
        if (
          (red + green + blue) / 3 < 238 ||
          Math.max(red, green, blue) - Math.min(red, green, blue) > 12
        ) {
          structured += 1;
        }
        if (red - Math.max(green, blue) > 12) gridTint += 1;
        pixels += 1;
      }
    }
    return pixels === 0
      ? { gridTintRatio: 0, structuredRatio: 0 }
      : { gridTintRatio: gridTint / pixels, structuredRatio: structured / pixels };
  };
  for (const [key, candidate] of brightBlocks) {
    if (visited.has(key)) continue;
    const component: typeof selected = [];
    const pending = [candidate];
    let touchesBoundary = false;
    visited.add(key);
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      component.push(current);
      touchesBoundary ||=
        current.row === 0 ||
        current.column === 0 ||
        current.row === rows - 1 ||
        current.column === columns - 1;
      for (const [nextRow, nextColumn] of [
        [current.row - 1, current.column],
        [current.row + 1, current.column],
        [current.row, current.column - 1],
        [current.row, current.column + 1],
      ]) {
        const nextKey = `${nextRow}:${nextColumn}`;
        const next = brightBlocks.get(nextKey);
        if (!next || visited.has(nextKey)) continue;
        visited.add(nextKey);
        pending.push(next);
      }
    }
    const componentLeft = Math.min(...component.map((item) => item.left));
    const componentRight = Math.max(...component.map((item) => item.right));
    const componentTop = Math.min(...component.map((item) => item.top));
    const componentBottom = Math.max(...component.map((item) => item.bottom));
    const structuredSides = [
      {
        bottom: componentTop,
        left: componentLeft,
        right: componentRight,
        top: componentTop - block,
      },
      {
        bottom: componentBottom + block,
        left: componentLeft,
        right: componentRight,
        top: componentBottom,
      },
      {
        bottom: componentBottom,
        left: componentLeft - block,
        right: componentLeft,
        top: componentTop,
      },
      {
        bottom: componentBottom,
        left: componentRight,
        right: componentRight + block,
        top: componentTop,
      },
    ].map((area) => {
      if (area.left < left || area.right > right || area.top < top || area.bottom > bottom) {
        return false;
      }
      const evidence = contextEvidence(area);
      return evidence.gridTintRatio >= 0.02 || evidence.structuredRatio >= 0.15;
    });
    const surroundedByStructure = structuredSides.every(Boolean);
    if (
      !touchesBoundary &&
      componentBottom > waveformTop &&
      surroundedByStructure &&
      component.length >= 2 &&
      component.length > selected.length
    ) {
      selected = component;
    }
  }
  if (selected.length < 2) return undefined;
  const glareLeft = Math.min(...selected.map((candidate) => candidate.left));
  const glareRight = Math.max(...selected.map((candidate) => candidate.right));
  const glareTop = Math.min(...selected.map((candidate) => candidate.top));
  const glareBottom = Math.max(...selected.map((candidate) => candidate.bottom));
  return {
    height: (glareBottom - glareTop) / input.height,
    width: (glareRight - glareLeft) / input.width,
    x: glareLeft / input.width,
    y: glareTop / input.height,
  };
}

export function estimateCalibrationPixelsPerMillimeter(
  input: EcgPhotoQualityInput,
  region = regionFromCorners(input.corners),
): number | undefined {
  if (input.layout !== '12x1') return undefined;
  const { bottom, left, right, top } = pixelBounds(region, input.width, input.height);
  const regionWidth = right - left;
  const start = left + Math.max(1, Math.floor(regionWidth * 0.01));
  const end = Math.min(right, left + Math.ceil(regionWidth * 0.08));
  const bandHeight = (bottom - top) / 12;
  const pulseHeights: number[] = [];
  for (let band = 0; band < 12; band += 1) {
    const bandTop = Math.round(top + band * bandHeight);
    const bandBottom = Math.round(top + (band + 1) * bandHeight);
    let bandLongestRun = 0;
    for (let x = start; x < end; x += 1) {
      let longestRun = 0;
      let run = 0;
      for (let y = bandTop; y < bandBottom; y += 1) {
        const red = channel(input.rgb, input.width, x, y, 0);
        const green = channel(input.rgb, input.width, x, y, 1);
        const blue = channel(input.rgb, input.width, x, y, 2);
        if ((red + green + blue) / 3 < 135 || blue - Math.max(red, green) >= 24) {
          run += 1;
          longestRun = Math.max(longestRun, run);
        } else {
          run = 0;
        }
      }
      bandLongestRun = Math.max(bandLongestRun, longestRun);
    }
    if (bandLongestRun >= (bandBottom - bandTop) * 0.25) pulseHeights.push(bandLongestRun);
  }
  if (pulseHeights.length < 8) return undefined;
  pulseHeights.sort((leftValue, rightValue) => leftValue - rightValue);
  const middle = Math.floor(pulseHeights.length / 2);
  const medianHeight =
    pulseHeights.length % 2 === 1
      ? (pulseHeights[middle] ?? 0)
      : ((pulseHeights[middle - 1] ?? 0) + (pulseHeights[middle] ?? 0)) / 2;
  return medianHeight > 0 ? medianHeight / 10 : undefined;
}

function hasCalibrationPulse(input: EcgPhotoQualityInput, region: EcgNormalizedRegion): boolean {
  if (input.layout !== '12x1') return true;
  return estimateCalibrationPixelsPerMillimeter(input, region) !== undefined;
}

function croppedRegion(corners?: EcgPhotoCorners): EcgNormalizedRegion | undefined {
  if (!corners) return undefined;
  const region = regionFromCorners(corners);
  const sides = {
    bottom: region.y + region.height >= 0.995 && region.y >= 0.03,
    left: region.x <= 0.005 && region.x + region.width <= 0.97,
    right: region.x + region.width >= 0.995 && region.x >= 0.03,
    top: region.y <= 0.005 && region.y + region.height <= 0.97,
  };
  if (sides.left) return { height: 1, width: 0.06, x: 0, y: 0 };
  if (sides.right) return { height: 1, width: 0.06, x: 0.94, y: 0 };
  if (sides.top) return { height: 0.06, width: 1, x: 0, y: 0 };
  if (sides.bottom) return { height: 0.06, width: 1, x: 0, y: 0.94 };
  return undefined;
}

export function assessEcgPhotoQuality(
  input: EcgPhotoQualityInput,
): readonly EcgPhotoQualityIssue[] {
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 32 ||
    input.height < 32 ||
    input.rgb.length !== input.width * input.height * 3
  ) {
    throw new Error('Проверка качества получила неверное RGB-изображение ЭКГ.');
  }
  const region = regionFromCorners(input.corners);
  const issues: EcgPhotoQualityIssue[] = [];
  if (isBlurred(input, region)) {
    issues.push({
      code: 'blur',
      detail: 'Сетка и контуры кривой недостаточно резкие. Переснимите лист без движения камеры.',
      region,
      severity: 'blocking',
      title: 'Снимок размыт',
    });
  }
  const glare = glareRegion(input, region);
  if (glare) {
    issues.push({
      code: 'glare',
      detail: 'В отмеченной области пропадают сетка или кривая. Измените угол телефона или света.',
      region: glare,
      severity: 'blocking',
      title: 'На листе есть блик',
    });
  }
  const cropped = croppedRegion(input.corners);
  if (cropped) {
    issues.push({
      code: 'cropped-paper',
      detail: 'Сетка подходит к краю кадра только с одной стороны. Переснимите лист целиком.',
      region: cropped,
      severity: 'warning',
      title: 'Возможен обрезанный край',
    });
  }
  if (!hasCalibrationPulse(input, region)) {
    issues.push({
      code: 'missing-calibration',
      detail:
        'Слева не найден повторяющийся импульс 1 мВ. Проверьте, что начало всех строк попало в кадр.',
      region: { height: region.height, width: region.width * 0.12, x: region.x, y: region.y },
      severity: 'blocking',
      title: 'Не найдена калибровка',
    });
  }
  return issues;
}

export function mapEcgPhotoQualityIssuesToRegion(
  issues: readonly EcgPhotoQualityIssue[],
  region: EcgNormalizedRegion,
): readonly EcgPhotoQualityIssue[] {
  return issues.flatMap((issue) => {
    const left = Math.max(issue.region.x, region.x);
    const right = Math.min(issue.region.x + issue.region.width, region.x + region.width);
    const top = Math.max(issue.region.y, region.y);
    const bottom = Math.min(issue.region.y + issue.region.height, region.y + region.height);
    if (right <= left || bottom <= top || region.width <= 0 || region.height <= 0) return [];
    return [
      {
        ...issue,
        region: {
          height: (bottom - top) / region.height,
          width: (right - left) / region.width,
          x: (left - region.x) / region.width,
          y: (top - region.y) / region.height,
        },
      },
    ];
  });
}

export function ecgPhotoRegionFromCorners(corners: EcgPhotoCorners): EcgNormalizedRegion {
  return regionFromCorners(corners);
}
