import type { EcgDigitizationResult, EcgReviewMaps } from './ecg-model-contract';
import {
  estimateGridSpacing,
  findEcgRPeakIndices,
  findTraceRows,
  normalizeSparseProbability,
  projection,
  traceForBand,
} from './ecg-waveform-digitizer';
import { detectEcgLeadIntervals } from './ecg-waveform-measurements';
import {
  type EcgEditorCalibration,
  type EcgEditorPoint,
  type EcgLeadRegion,
  type EcgPointKind,
  ecgCalibrationScale,
  ecgRegionTemplate,
  pointInsideEcgRegion,
} from './ecgEditor';

export function prepareEcgEditorReview(result: EcgDigitizationResult):
  | {
      readonly maps: EcgReviewMaps;
      readonly regions: readonly EcgLeadRegion[];
      readonly calibration: Pick<EcgEditorCalibration, 'horizontal' | 'vertical'>;
    }
  | undefined {
  const input = result.reviewMaps;
  if (!input) return undefined;
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 128 ||
    input.height < 128 ||
    input.width > 2048 ||
    input.height > 2048 ||
    input.signalProbability.length !== input.width * input.height ||
    input.gridProbability.length !== input.width * input.height
  )
    throw new Error('Неверные карты разметки ЭКГ.');
  const maps = {
    ...input,
    signalProbability: normalizeSparseProbability(input.signalProbability),
    gridProbability: normalizeSparseProbability(input.gridProbability),
  };
  const corners = result.detectedGridCorners;
  const bounds = corners
    ? {
        x: corners.topLeft.x,
        y: corners.topLeft.y,
        width: corners.topRight.x - corners.topLeft.x,
        height: corners.bottomLeft.y - corners.topLeft.y,
      }
    : { x: 0.03, y: 0.03, width: 0.94, height: 0.94 };
  const template = ecgRegionTemplate(result.layout, bounds);
  const rowCount = result.layout === '12x1' ? 12 : 4;
  const rows = findTraceRows(
    projection(maps.signalProbability, maps.width, maps.height, 'y'),
    rowCount,
  );
  const regions =
    rows.length === rowCount
      ? template.map((r, index) => {
          const row = result.layout === '12x1' ? index : Math.min(3, Math.floor(index / 4));
          const center = (rows[row] ?? 0) / maps.height;
          const top = row ? ((rows[row - 1] ?? 0) / maps.height + center) / 2 : bounds.y;
          const bottom =
            row < rowCount - 1
              ? ((rows[row + 1] ?? maps.height) / maps.height + center) / 2
              : bounds.y + bounds.height;
          return {
            ...r,
            y: Math.max(0, top),
            height: Math.max(0.01, Math.min(1, bottom) - Math.max(0, top)),
          };
        })
      : template;
  const gridX = estimateGridSpacing(projection(maps.gridProbability, maps.width, maps.height, 'x'));
  const gridY = estimateGridSpacing(projection(maps.gridProbability, maps.width, maps.height, 'y'));
  const dx = gridX ? (25 * gridX) / maps.width : 0;
  const dy = gridY ? (10 * gridY) / maps.height : 0;
  const x = bounds.x + bounds.width * 0.1;
  const y = bounds.y + bounds.height * 0.15;
  return {
    maps,
    regions,
    calibration: {
      ...(dx > 0 && x + dx < 1 ? { horizontal: { start: { x, y }, end: { x: x + dx, y } } } : {}),
      ...(dy > 0 && y + dy < 1 ? { vertical: { start: { x, y }, end: { x, y: y + dy } } } : {}),
    },
  };
}

export interface EcgRegionExtraction {
  readonly regionId: string;
  readonly path: string;
  readonly coverage: number;
  readonly points: readonly EcgEditorPoint[];
}

/** Fixed user regions and grid calibration control extraction, never the template's nominal duration. */
export function extractEcgEditorRegion(
  maps: EcgReviewMaps,
  region: EcgLeadRegion,
  calibration: EcgEditorCalibration,
): EcgRegionExtraction {
  const empty = { regionId: region.id, path: '', coverage: 0, points: [] };
  const scale = ecgCalibrationScale(calibration);
  if (!scale) return empty;
  const left = Math.max(0, Math.floor(region.x * maps.width));
  const right = Math.min(maps.width, Math.ceil((region.x + region.width) * maps.width));
  const top = Math.max(0, Math.floor(region.y * maps.height));
  const bottom = Math.min(maps.height, Math.ceil((region.y + region.height) * maps.height));
  const trace = traceForBand(maps.signalProbability, maps.width, top, bottom, 0.03).slice(
    left,
    right,
  );
  const finite = [...trace].filter(Number.isFinite).sort((a, b) => a - b);
  const baseline = finite[Math.floor(finite.length / 2)];
  if (baseline === undefined || trace.length < 2) return empty;
  const durationSeconds = (trace.length - 1) / maps.width / scale.x / calibration.speed;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60)
    return empty;
  const samples = new Float32Array(Math.round(durationSeconds * 100) + 1).fill(Number.NaN);
  const yAt = (offset: number): number => {
    const low = Math.floor(offset);
    const a = trace[low] ?? Number.NaN;
    const b = trace[Math.min(trace.length - 1, low + 1)] ?? Number.NaN;
    return a + (b - a) * (offset - low);
  };
  for (let i = 0; i < samples.length; i += 1) {
    const offset = (i / 100) * calibration.speed * scale.x * maps.width;
    samples[i] = (baseline - yAt(offset)) / maps.height / scale.y / calibration.gain;
  }
  const coverage = [...samples].filter(Number.isFinite).length / samples.length;
  let open = false;
  const segments: string[] = [];
  for (let i = 0; i < trace.length; i += 1) {
    const y = trace[i];
    if (!Number.isFinite(y)) {
      open = false;
      continue;
    }
    segments.push(
      `${open ? 'L' : 'M'}${(((left + i) / maps.width) * 1000).toFixed(2)},${(((y ?? 0) / maps.height) * 1000).toFixed(2)}`,
    );
    open = true;
  }
  const points: EcgEditorPoint[] = [];
  const add = (kind: EcgPointKind, index: number | undefined): void => {
    if (index === undefined) return;
    const offset = (index / 100) * calibration.speed * scale.x * maps.width;
    const point = { x: (left + offset) / maps.width, y: yAt(offset) / maps.height };
    if (pointInsideEcgRegion(point, region))
      points.push({
        ...point,
        kind,
        regionId: region.id,
        id: `${region.id}-${kind}-${index}`,
        source: 'auto',
      });
  };
  // ponytail: one representative complex per lead; multi-beat delineation needs a validated model.
  const detected = detectEcgLeadIntervals(
    {
      name: region.lead,
      coverage,
      durationSeconds,
      samples,
      reviewed: false,
      source: 'photo-auto',
      startSecond: 0,
    },
    100,
  );
  if (detected && coverage >= 0.9) {
    for (const [kind, index] of Object.entries(detected.fiducials))
      add(kind as Exclude<EcgPointKind, 'baseline' | 'pPeak'>, index);
    const rIndices = findEcgRPeakIndices(samples);
    for (const index of rIndices) {
      if (Math.abs(index - detected.fiducials.rPeak) >= 20) add('rPeak', index);
    }
    const r = points.find((p) => p.kind === 'rPeak');
    if (r)
      points.push({
        id: `${region.id}-baseline`,
        regionId: region.id,
        kind: 'baseline',
        source: 'auto',
        x: r.x,
        y: baseline / maps.height,
      });
  }
  return { regionId: region.id, coverage, path: segments.join(' '), points };
}
