import {
  ECG_STANDARD_LEADS,
  type EcgDigitizationResult,
  type EcgDigitizedLead,
  type EcgLeadName,
  type EcgPhotoCorners,
} from '@/features/calculators/ecg-model-contract';

export interface EcgSegmentationMaps {
  readonly calibrationPixelsPerMillimeter?: number;
  readonly gridProbability: Float32Array;
  readonly height: number;
  readonly layoutHint?: '12x1';
  readonly pixelAspectRatio: number;
  readonly signalProbability: Float32Array;
  readonly width: number;
}

export function enhanceSignalWithBlueInk(
  signalProbability: Float32Array,
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
): { readonly detected: boolean; readonly signalProbability: Float32Array } {
  const height = signalProbability.length / width;
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    rgb.length !== signalProbability.length * 3
  ) {
    return { detected: false, signalProbability };
  }
  const ink = new Float32Array(signalProbability.length);
  const rowCounts = new Uint32Array(height);
  const columnCounts = new Uint32Array(width);
  let maximum = 0;
  for (let pixel = 0; pixel < signalProbability.length; pixel += 1) {
    const offset = pixel * 3;
    const score = Math.max(
      0,
      (rgb[offset + 2] ?? 0) - Math.max(rgb[offset] ?? 0, rgb[offset + 1] ?? 0),
    );
    ink[pixel] = score;
    maximum = Math.max(maximum, score);
    if (score >= 24) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      rowCounts[y] = (rowCounts[y] ?? 0) + 1;
      columnCounts[x] = (columnCounts[x] ?? 0) + 1;
    }
  }
  let visiblePixels = 0;
  for (let pixel = 0; pixel < ink.length; pixel += 1) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if ((rowCounts[y] ?? 0) > width * 0.65 || (columnCounts[x] ?? 0) > height * 0.65) {
      ink[pixel] = 0;
    } else if ((ink[pixel] ?? 0) >= 24) {
      visiblePixels += 1;
    }
  }
  if (maximum < 24 || visiblePixels < signalProbability.length * 0.002) {
    return { detected: false, signalProbability };
  }
  return {
    detected: true,
    signalProbability: Float32Array.from(signalProbability, (value, pixel) =>
      Math.max(value, (ink[pixel] ?? 0) / maximum),
    ),
  };
}

const SAMPLE_RATE_HZ = 100 as const;
const ROW_LAYOUT: readonly (readonly EcgLeadName[])[] = [
  ['I', 'aVR', 'V1', 'V4'],
  ['II', 'aVL', 'V2', 'V5'],
  ['III', 'aVF', 'V3', 'V6'],
];

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return Number.NaN;
  if (sorted.length % 2 === 1) return value;
  return ((sorted[middle - 1] ?? value) + value) / 2;
}

function finiteCoverage(values: Float32Array): number {
  let count = 0;
  for (const value of values) if (Number.isFinite(value)) count += 1;
  return values.length > 0 ? count / values.length : 0;
}

function normalizeSparseProbability(values: Float32Array): Float32Array {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let maximum = 0;
  const output = Float32Array.from(values, (value) => {
    const sparse = Math.max(0, value - mean);
    maximum = Math.max(maximum, sparse);
    return sparse;
  });
  if (maximum <= 0) return output;
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (output[index] ?? 0) / maximum;
  }
  return output;
}

function projection(
  values: Float32Array,
  width: number,
  height: number,
  axis: 'x' | 'y',
): Float32Array {
  const length = axis === 'x' ? width : height;
  const output = new Float32Array(length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = values[y * width + x] ?? 0;
      const index = axis === 'x' ? x : y;
      output[index] = (output[index] ?? 0) + value;
    }
  }
  const divisor = axis === 'x' ? height : width;
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (output[index] ?? 0) / divisor;
  }
  return output;
}

function activeProjectionRange(values: Float32Array): readonly [number, number] {
  const maximum = Math.max(...values);
  if (maximum <= 0) return [0, values.length];
  const threshold = maximum * 0.12;
  const first = values.findIndex((value) => value >= threshold);
  let last = values.length - 1;
  while (last >= 0 && (values[last] ?? 0) < threshold) last -= 1;
  if (first < 0 || last < first || last - first + 1 < values.length * 0.45) {
    return [0, values.length];
  }
  const padding = Math.max(2, Math.round((last - first + 1) * 0.015));
  return [Math.max(0, first - padding), Math.min(values.length, last + padding + 1)];
}

function cropMapsToGrid(maps: EcgSegmentationMaps): {
  readonly corners?: EcgPhotoCorners;
  readonly maps: EcgSegmentationMaps;
} {
  const horizontal = activeProjectionRange(
    projection(maps.gridProbability, maps.width, maps.height, 'x'),
  );
  const vertical = activeProjectionRange(
    projection(maps.gridProbability, maps.width, maps.height, 'y'),
  );
  const width = horizontal[1] - horizontal[0];
  const height = vertical[1] - vertical[0];
  if (width === maps.width && height === maps.height) return { maps };
  const gridProbability = new Float32Array(width * height);
  const signalProbability = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (vertical[0] + y) * maps.width + horizontal[0];
    gridProbability.set(maps.gridProbability.subarray(sourceStart, sourceStart + width), y * width);
    signalProbability.set(
      maps.signalProbability.subarray(sourceStart, sourceStart + width),
      y * width,
    );
  }
  return {
    corners: {
      bottomLeft: { x: horizontal[0] / maps.width, y: vertical[1] / maps.height },
      bottomRight: { x: horizontal[1] / maps.width, y: vertical[1] / maps.height },
      topLeft: { x: horizontal[0] / maps.width, y: vertical[0] / maps.height },
      topRight: { x: horizontal[1] / maps.width, y: vertical[0] / maps.height },
    },
    maps: { ...maps, gridProbability, height, signalProbability, width },
  };
}

export function estimateGridSpacing(projectionValues: Float32Array): number | undefined {
  if (projectionValues.length < 32) return undefined;
  const mean = projectionValues.reduce((sum, value) => sum + value, 0) / projectionValues.length;
  const centered = Float32Array.from(projectionValues, (value) => value - mean);
  const scores: number[] = [];
  const maximumLag = Math.min(32, Math.floor(projectionValues.length / 8));
  for (let lag = 2; lag <= maximumLag; lag += 1) {
    let numerator = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = lag; index < centered.length; index += 1) {
      const left = centered[index - lag] ?? 0;
      const right = centered[index] ?? 0;
      numerator += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    scores[lag] = numerator / Math.max(1e-9, Math.sqrt(leftEnergy * rightEnergy));
  }
  const candidates: { lag: number; score: number }[] = [];
  for (let lag = 3; lag < maximumLag; lag += 1) {
    const score = scores[lag] ?? -1;
    if (score > 0.15 && score >= (scores[lag - 1] ?? -1) && score >= (scores[lag + 1] ?? -1)) {
      candidates.push({ lag, score });
    }
  }
  const strongest = Math.max(...candidates.map((candidate) => candidate.score), 0);
  return candidates.find((candidate) => candidate.score >= strongest * 0.55)?.lag;
}

function smooth(values: Float32Array, radius: number): Float32Array {
  const output = new Float32Array(values.length);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] ?? 0;
    if (index - radius - 1 >= 0) sum -= values[index - radius - 1] ?? 0;
    output[index] = sum / Math.min(index + 1, radius + 1);
  }
  return output;
}

export function findTraceRows(signalProjection: Float32Array, expectedRows = 4): readonly number[] {
  const values = smooth(signalProjection, 5);
  const minimumSeparation = Math.max(8, Math.floor(values.length / (expectedRows * 2.2)));
  const candidates = [...values.keys()]
    .filter(
      (index) =>
        index > 0 &&
        index < values.length - 1 &&
        (values[index] ?? 0) >= (values[index - 1] ?? 0) &&
        (values[index] ?? 0) >= (values[index + 1] ?? 0),
    )
    .sort((left, right) => (values[right] ?? 0) - (values[left] ?? 0));
  const selected: number[] = [];
  for (const candidate of candidates) {
    if (selected.every((row) => Math.abs(row - candidate) >= minimumSeparation)) {
      selected.push(candidate);
      if (selected.length === expectedRows) break;
    }
  }
  return selected.sort((left, right) => left - right);
}

function assessTwelveLeadRows(
  signalProjection: Float32Array,
  rows: readonly number[],
): { readonly confident: boolean; readonly evidence: boolean } {
  if (rows.length !== ECG_STANDARD_LEADS.length) return { confident: false, evidence: false };
  const values = smooth(signalProjection, 5);
  const maximum = Math.max(...values);
  const baseline = median([...values]);
  const contrast = maximum - baseline;
  if (!Number.isFinite(maximum) || !Number.isFinite(baseline) || contrast <= maximum * 0.25) {
    return { confident: false, evidence: false };
  }
  const strongRows = rows.filter((row, index) => {
    const previous = rows[index - 1] ?? 0;
    const next = rows[index + 1] ?? values.length - 1;
    const radius = Math.max(6, Math.floor(Math.min(row - previous, next - row) * 0.4));
    const background = median([
      ...values.slice(Math.max(0, row - radius), Math.max(0, row - 2)),
      ...values.slice(Math.min(values.length, row + 3), Math.min(values.length, row + radius + 1)),
    ]);
    return (
      Number.isFinite(background) &&
      (values[row] ?? 0) >= background + Math.max(contrast * 0.005, background * 0.5)
    );
  }).length;
  const gaps = rows.slice(1).map((row, index) => row - (rows[index] ?? row));
  const typicalGap = median(gaps);
  const regularSpacing =
    Number.isFinite(typicalGap) &&
    typicalGap > 0 &&
    gaps.every((gap) => gap >= typicalGap * 0.45 && gap <= typicalGap * 1.8);
  const spansPage = (rows.at(-1) ?? 0) - (rows[0] ?? 0) >= values.length * 0.55;
  const evidence = strongRows >= 10 && regularSpacing && spansPage;
  return {
    confident: evidence,
    evidence,
  };
}

function traceForBand(
  probabilities: Float32Array,
  width: number,
  top: number,
  bottom: number,
  threshold = 0.1,
): Float32Array {
  const trace = new Float32Array(width).fill(Number.NaN);
  for (let x = 0; x < width; x += 1) {
    let bestY = -1;
    let best = 0;
    for (let y = top; y < bottom; y += 1) {
      const probability = probabilities[y * width + x] ?? 0;
      if (probability > best) {
        best = probability;
        bestY = y;
      }
    }
    if (best >= threshold) trace[x] = bestY;
  }
  return trace;
}

function interpolateShortTraceGaps(trace: Float32Array, maximumGap: number): Float32Array {
  const output = Float32Array.from(trace);
  let previous = -1;
  for (let index = 0; index < output.length; index += 1) {
    if (!Number.isFinite(output[index])) continue;
    if (previous >= 0 && index - previous - 1 <= maximumGap) {
      const left = output[previous] ?? 0;
      const right = output[index] ?? left;
      for (let fill = previous + 1; fill < index; fill += 1) {
        output[fill] = left + ((right - left) * (fill - previous)) / (index - previous);
      }
    }
    previous = index;
  }
  return output;
}

function resampleVoltage(
  trace: Float32Array,
  start: number,
  end: number,
  count: number,
  pixelsPerMillimeter: number,
): Float32Array {
  const source = [...trace.slice(start, end)].filter(Number.isFinite);
  const baseline = median(source);
  const output = new Float32Array(count).fill(Number.NaN);
  if (!Number.isFinite(baseline) || end <= start || count < 1) return output;
  for (let index = 0; index < count; index += 1) {
    const x = start + (index / Math.max(1, count - 1)) * (end - start - 1);
    const left = Math.floor(x);
    const right = Math.min(end - 1, left + 1);
    const leftValue = trace[left];
    const rightValue = trace[right];
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue;
    const y =
      (leftValue ?? baseline) + ((rightValue ?? baseline) - (leftValue ?? baseline)) * (x - left);
    output[index] = (baseline - y) / pixelsPerMillimeter / 10;
  }
  return output;
}

function interpolateMissing(values: Float32Array): Float32Array | undefined {
  if (finiteCoverage(values) < 0.8) return undefined;
  const output = Float32Array.from(values);
  let previous = -1;
  for (let index = 0; index < output.length; index += 1) {
    if (!Number.isFinite(output[index])) continue;
    if (previous < 0) {
      for (let fill = 0; fill < index; fill += 1) output[fill] = output[index] ?? 0;
    } else if (index - previous > 1) {
      const left = output[previous] ?? 0;
      const right = output[index] ?? left;
      for (let fill = previous + 1; fill < index; fill += 1) {
        output[fill] = left + ((right - left) * (fill - previous)) / (index - previous);
      }
    }
    previous = index;
  }
  if (previous < 0) return undefined;
  for (let fill = previous + 1; fill < output.length; fill += 1)
    output[fill] = output[previous] ?? 0;
  return output;
}

function waveformCorrelation(left: Float32Array, right: Float32Array): number | undefined {
  const count = Math.min(left.length, right.length);
  const pairs: [number, number][] = [];
  for (let index = 0; index < count; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue))
      pairs.push([leftValue ?? 0, rightValue ?? 0]);
  }
  if (pairs.length < SAMPLE_RATE_HZ / 2) return undefined;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (const pair of pairs) {
    const centeredLeft = pair[0] - leftMean;
    const centeredRight = pair[1] - rightMean;
    numerator += centeredLeft * centeredRight;
    leftEnergy += centeredLeft * centeredLeft;
    rightEnergy += centeredRight * centeredRight;
  }
  if (leftEnergy <= 1e-9 || rightEnergy <= 1e-9) return undefined;
  return numerator / Math.sqrt(leftEnergy * rightEnergy);
}

export function estimateRrIntervalsMs(rhythm: Float32Array): readonly number[] {
  const values = interpolateMissing(rhythm);
  if (!values || values.length < SAMPLE_RATE_HZ * 2) return [];
  const movingAverage = (input: Float32Array, radius: number): Float32Array => {
    const prefix = new Float64Array(input.length + 1);
    for (let index = 0; index < input.length; index += 1) {
      prefix[index + 1] = (prefix[index] ?? 0) + (input[index] ?? 0);
    }
    const divisor = radius * 2 + 1;
    return Float32Array.from(input, (_, index) => {
      const start = Math.max(0, index - radius);
      const end = Math.min(input.length, index + radius + 1);
      return ((prefix[end] ?? 0) - (prefix[start] ?? 0)) / divisor;
    });
  };
  const baseline = movingAverage(values, Math.round(SAMPLE_RATE_HZ * 0.3));
  const centered = Float32Array.from(values, (value, index) => value - (baseline[index] ?? 0));
  const derivativeEnergy = new Float32Array(centered.length);
  for (let index = 1; index < centered.length; index += 1) {
    const derivative = (centered[index] ?? 0) - (centered[index - 1] ?? 0);
    derivativeEnergy[index] = derivative * derivative;
  }
  const integrated = movingAverage(derivativeEnergy, Math.round(SAMPLE_RATE_HZ * 0.06));
  const sorted = [...integrated].sort((left, right) => left - right);
  const low = median(sorted);
  const high = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (high <= low) return [];
  const threshold = low + (high - low) * 0.12;
  const energyPeaks: number[] = [];
  const refractory = Math.round(SAMPLE_RATE_HZ * 0.25);
  for (let index = 1; index < integrated.length - 1; index += 1) {
    const value = integrated[index] ?? 0;
    if (
      value < threshold ||
      value < (integrated[index - 1] ?? 0) ||
      value < (integrated[index + 1] ?? 0)
    )
      continue;
    const previous = energyPeaks.at(-1);
    if (previous === undefined || index - previous >= refractory) energyPeaks.push(index);
    else if (value > (integrated[previous] ?? 0)) energyPeaks[energyPeaks.length - 1] = index;
  }
  const peaks: number[] = [];
  const refinementRadius = Math.round(SAMPLE_RATE_HZ * 0.08);
  for (const candidate of energyPeaks) {
    const start = Math.max(0, candidate - refinementRadius);
    const end = Math.min(centered.length, candidate + refinementRadius + 1);
    let peak = start;
    for (let index = start + 1; index < end; index += 1) {
      if (Math.abs(centered[index] ?? 0) > Math.abs(centered[peak] ?? 0)) peak = index;
    }
    const previous = peaks.at(-1);
    if (previous === undefined || peak - previous >= refractory) peaks.push(peak);
    else if (Math.abs(centered[peak] ?? 0) > Math.abs(centered[previous] ?? 0))
      peaks[peaks.length - 1] = peak;
  }
  if (peaks.length < 3) return [];
  return peaks
    .slice(1)
    .map((peak, index) => Math.round(((peak - (peaks[index] ?? peak)) / SAMPLE_RATE_HZ) * 1000));
}

export function extractDigitizedEcg(maps: EcgSegmentationMaps): EcgDigitizationResult {
  if (
    !Number.isInteger(maps.width) ||
    !Number.isInteger(maps.height) ||
    maps.width < 128 ||
    maps.height < 128 ||
    !Number.isFinite(maps.pixelAspectRatio) ||
    maps.pixelAspectRatio <= 0 ||
    maps.signalProbability.length !== maps.width * maps.height ||
    maps.gridProbability.length !== maps.width * maps.height
  ) {
    throw new Error('Оцифровщик получил неверный размер карты сегментации.');
  }
  const cropped = cropMapsToGrid({
    ...maps,
    gridProbability: normalizeSparseProbability(maps.gridProbability),
    signalProbability: normalizeSparseProbability(maps.signalProbability),
  });
  const normalized = cropped.maps;
  const { width, height, pixelAspectRatio, signalProbability, gridProbability } = normalized;

  const gridX = estimateGridSpacing(projection(gridProbability, width, height, 'x'));
  const gridY = estimateGridSpacing(projection(gridProbability, width, height, 'y'));
  const signalProjection = projection(signalProbability, width, height, 'y');
  const rows = findTraceRows(signalProjection);
  const twelveRows = findTraceRows(signalProjection, ECG_STANDARD_LEADS.length);
  const twelveRowAssessment = assessTwelveLeadRows(signalProjection, twelveRows);
  const layout =
    normalized.layoutHint === '12x1' && twelveRowAssessment.evidence ? '12x1' : '3x4+1R';
  const calibrationGridSpacing =
    Number.isFinite(normalized.calibrationPixelsPerMillimeter) &&
    (normalized.calibrationPixelsPerMillimeter ?? 0) >= 1
      ? (normalized.calibrationPixelsPerMillimeter ?? 0) / pixelAspectRatio
      : undefined;
  const reasons: string[] = [];
  if (
    (!Number.isFinite(gridX) || (gridX ?? 0) < 2) &&
    (!Number.isFinite(gridY) || (gridY ?? 0) / pixelAspectRatio < 2) &&
    calibrationGridSpacing === undefined
  )
    reasons.push('Не удалось надёжно определить сетку 1 мм.');
  if (layout === '3x4+1R' && rows.length !== 4)
    reasons.push('Не удалось выделить три строки отведений и ритм-строку.');
  if (layout === '12x1' && !twelveRowAssessment.confident)
    reasons.push('Не удалось надёжно выделить 12 строк отведений.');

  let horizontalGridSpacing =
    Number.isFinite(gridX) && (gridX ?? 0) >= 2
      ? (gridX ?? 1)
      : Number.isFinite(gridY) && (gridY ?? 0) / pixelAspectRatio >= 2
        ? (gridY ?? 1) / pixelAspectRatio
        : 1;
  let durationSeconds = (width / horizontalGridSpacing) * 0.02;
  if (durationSeconds < 4 && horizontalGridSpacing / 5 >= 2) {
    horizontalGridSpacing /= 5;
    durationSeconds = (width / horizontalGridSpacing) * 0.02;
  }
  if ((durationSeconds < 4 || durationSeconds > 12) && calibrationGridSpacing !== undefined) {
    horizontalGridSpacing = calibrationGridSpacing;
    durationSeconds = (width / horizontalGridSpacing) * 0.02;
  }
  const expectedVerticalGridSpacing = horizontalGridSpacing * pixelAspectRatio;
  const verticalGridSpacing =
    Number.isFinite(gridY) &&
    (gridY ?? 0) >= expectedVerticalGridSpacing * 0.6 &&
    (gridY ?? 0) <= expectedVerticalGridSpacing * 1.8
      ? (gridY ?? expectedVerticalGridSpacing)
      : expectedVerticalGridSpacing;
  if (durationSeconds < 4 || durationSeconds > 12)
    reasons.push('Длительность записи по сетке вышла за диапазон 4–12 с.');
  if (
    (layout === '3x4+1R' && rows.length !== 4) ||
    (layout === '12x1' && !twelveRowAssessment.confident) ||
    reasons.length > 1
  ) {
    return {
      ...(cropped.corners ? { detectedGridCorners: cropped.corners } : {}),
      durationSeconds,
      gridPixelsPerMillimeter: horizontalGridSpacing,
      layout,
      leads: [],
      quality: 'failed',
      qualityIssues: [],
      qualityReasons: reasons,
      rhythmCoverage: 0,
      rrIntervalsMs: [],
      sampleRateHz: SAMPLE_RATE_HZ,
    };
  }

  if (layout === '12x1') {
    const boundaries = [
      0,
      ...twelveRows
        .slice(0, -1)
        .map((row, index) => Math.round((row + (twelveRows[index + 1] ?? row)) / 2)),
      height,
    ];
    const traces = twelveRows.map((_, index) =>
      interpolateShortTraceGaps(
        traceForBand(
          signalProbability,
          width,
          boundaries[index] ?? 0,
          boundaries[index + 1] ?? height,
          0.03,
        ),
        Math.max(2, Math.round(width * 0.03)),
      ),
    );
    const durationSamples = Math.max(1, Math.round(durationSeconds * SAMPLE_RATE_HZ));
    const leads: EcgDigitizedLead[] = [];
    for (let row = 0; row < ECG_STANDARD_LEADS.length; row += 1) {
      const name = ECG_STANDARD_LEADS[row];
      const trace = traces[row];
      if (!name || !trace) continue;
      const samples = resampleVoltage(trace, 0, width, durationSamples, verticalGridSpacing);
      leads.push({
        coverage: finiteCoverage(samples),
        durationSeconds,
        name,
        reviewed: false,
        samples,
        source: 'photo-auto',
        startSecond: 0,
      });
    }
    const rhythmLead = leads.find((lead) => lead.name === 'II');
    const rhythmSamples = rhythmLead?.samples ?? new Float32Array();
    const rhythmCoverage = finiteCoverage(rhythmSamples);
    if (rhythmCoverage < 0.8) reasons.push('Ритм-строка II извлечена менее чем на 80%.');
    if (leads.filter((lead) => lead.coverage >= 0.7).length < ECG_STANDARD_LEADS.length) {
      reasons.push('Не все 12 отведений извлечены с достаточным покрытием.');
    }
    const rrIntervalsMs = estimateRrIntervalsMs(rhythmSamples);
    const rrMedianMs = median(rrIntervalsMs);
    const rrMs = Number.isFinite(rrMedianMs) ? Math.round(rrMedianMs) : undefined;
    if (!rrMs) reasons.push('Не удалось устойчиво определить RR по отведению II.');
    const quality = reasons.length === 0 ? 'usable' : 'review';
    return {
      ...(cropped.corners ? { detectedGridCorners: cropped.corners } : {}),
      durationSeconds,
      gridPixelsPerMillimeter: horizontalGridSpacing,
      ...(rrMs ? { heartRate: Math.round(60000 / rrMs), rrMs } : {}),
      layout,
      leads,
      quality,
      qualityIssues: [],
      qualityReasons: reasons,
      rhythmCoverage,
      ...(rhythmLead ? { rhythmLead } : {}),
      rrIntervalsMs,
      sampleRateHz: SAMPLE_RATE_HZ,
    };
  }

  const boundaries = [
    0,
    Math.round(((rows[0] ?? 0) + (rows[1] ?? height / 2)) / 2),
    Math.round(((rows[1] ?? height / 3) + (rows[2] ?? (height * 2) / 3)) / 2),
    Math.round(((rows[2] ?? height / 2) + (rows[3] ?? height)) / 2),
    height,
  ];
  const traces = rows.map((_, index) =>
    traceForBand(signalProbability, width, boundaries[index] ?? 0, boundaries[index + 1] ?? height),
  );
  const segmentDuration = durationSeconds / 4;
  const segmentSamples = Math.max(1, Math.round(segmentDuration * SAMPLE_RATE_HZ));
  const leads: EcgDigitizedLead[] = [];
  for (let row = 0; row < 3; row += 1) {
    const trace = traces[row];
    if (!trace) continue;
    for (let column = 0; column < 4; column += 1) {
      const name = ROW_LAYOUT[row]?.[column];
      if (!name) continue;
      const start = Math.round((column * width) / 4);
      const end = Math.round(((column + 1) * width) / 4);
      const samples = resampleVoltage(trace, start, end, segmentSamples, verticalGridSpacing);
      leads.push({
        coverage: finiteCoverage(samples),
        durationSeconds: segmentDuration,
        name,
        reviewed: false,
        samples,
        source: 'photo-auto',
        startSecond: column * segmentDuration,
      });
    }
  }
  const rhythmTrace = traces[3];
  const rhythmSamples = rhythmTrace
    ? resampleVoltage(
        rhythmTrace,
        0,
        width,
        Math.max(1, Math.round(durationSeconds * SAMPLE_RATE_HZ)),
        verticalGridSpacing,
      )
    : new Float32Array();
  const rhythmCoverage = finiteCoverage(rhythmSamples);
  if (rhythmCoverage < 0.8) reasons.push('Ритм-строка II извлечена менее чем на 80%.');
  if (leads.filter((lead) => lead.coverage >= 0.7).length < 12) {
    reasons.push('Не все 12 отведений извлечены с достаточным покрытием.');
  }
  const repeatedLeadII = leads.find((lead) => lead.name === 'II');
  const repeatedLeadCorrelation = repeatedLeadII
    ? waveformCorrelation(
        repeatedLeadII.samples,
        rhythmSamples.slice(0, repeatedLeadII.samples.length),
      )
    : undefined;
  if (repeatedLeadCorrelation !== undefined && repeatedLeadCorrelation < 0.85) {
    reasons.push('Повторное отведение II не совпало с ритм-строкой; проверьте перспективу фото.');
  }
  const rrIntervalsMs = estimateRrIntervalsMs(rhythmSamples);
  const rrMedianMs = median(rrIntervalsMs);
  const rrMs = Number.isFinite(rrMedianMs) ? Math.round(rrMedianMs) : undefined;
  if (!rrMs) reasons.push('Не удалось устойчиво определить RR по ритм-строке II.');
  const quality = reasons.length === 0 ? 'usable' : 'review';
  return {
    ...(cropped.corners ? { detectedGridCorners: cropped.corners } : {}),
    durationSeconds,
    gridPixelsPerMillimeter: horizontalGridSpacing,
    ...(rrMs ? { heartRate: Math.round(60000 / rrMs), rrMs } : {}),
    layout: '3x4+1R',
    leads,
    quality,
    qualityIssues: [],
    qualityReasons: reasons,
    rhythmCoverage,
    rhythmLead: {
      coverage: rhythmCoverage,
      durationSeconds,
      name: 'II',
      reviewed: false,
      samples: rhythmSamples,
      source: 'photo-auto',
      startSecond: 0,
    },
    rrIntervalsMs,
    sampleRateHz: SAMPLE_RATE_HZ,
  };
}
