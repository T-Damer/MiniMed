import {
  ECG_STANDARD_LEADS,
  type EcgLeadName,
  type EcgNormalizedPoint,
  type EcgNormalizedRegion,
} from './ecg-model-contract';
import {
  calculateEcgMeasurements,
  type EcgIntervalId,
  type EcgMeasurements,
  type EcgPointPair,
} from './ecg-photo-caliper';

export type EcgEditorStep = 1 | 2 | 3 | 4 | 5;
export type EcgEditorLayout = '3x4+1R' | '12x1';
export interface EcgCalibrationLine {
  readonly start: EcgNormalizedPoint;
  readonly end: EcgNormalizedPoint;
}
export interface EcgEditorCalibration {
  readonly speed: 25 | 50;
  readonly gain: 5 | 10 | 20;
  readonly horizontal?: EcgCalibrationLine;
  readonly vertical?: EcgCalibrationLine;
}
export interface EcgLeadRegion extends EcgNormalizedRegion {
  readonly id: string;
  readonly lead: EcgLeadName;
}
export const ECG_POINT_LABELS = {
  pOnset: 'Начало P',
  pPeak: 'Вершина P',
  pOffset: 'Конец P',
  qrsOnset: 'Начало QRS',
  qPeak: 'Вершина Q',
  rPeak: 'Вершина R',
  sPeak: 'Вершина S',
  qrsOffset: 'Конец QRS',
  tOnset: 'Начало T',
  tPeak: 'Вершина T',
  tOffset: 'Конец T',
  baseline: 'Изолиния',
} as const;
export type EcgPointKind = keyof typeof ECG_POINT_LABELS;
export const ECG_POINT_GROUPS: readonly {
  readonly label: string;
  readonly kinds: readonly EcgPointKind[];
}[] = [
  { label: 'P', kinds: ['pOnset', 'pPeak', 'pOffset'] },
  { label: 'Q', kinds: ['qrsOnset', 'qPeak'] },
  { label: 'R', kinds: ['rPeak'] },
  { label: 'S', kinds: ['sPeak', 'qrsOffset'] },
  { label: 'T', kinds: ['tOnset', 'tPeak', 'tOffset'] },
];
export interface EcgEditorPoint extends EcgNormalizedPoint {
  readonly id: string;
  readonly regionId: string;
  readonly kind: EcgPointKind;
  readonly source: 'auto' | 'manual';
}
export interface EcgEditorDraft {
  readonly calibration: EcgEditorCalibration;
  readonly regions: readonly EcgLeadRegion[];
  readonly points: readonly EcgEditorPoint[];
}

export const EMPTY_ECG_DRAFT: EcgEditorDraft = {
  calibration: { speed: 25, gain: 10 },
  regions: [],
  points: [],
};

export function ecgCalibrationScale(
  calibration: EcgEditorCalibration,
): { x: number; y: number } | undefined {
  const horizontal = calibration.horizontal;
  const vertical = calibration.vertical;
  if (!horizontal || !vertical) return undefined;
  if (![horizontal.start, horizontal.end, vertical.start, vertical.end].every(validEcgPoint))
    return undefined;
  const x = Math.abs(horizontal.end.x - horizontal.start.x) / 25;
  const y = Math.abs(vertical.end.y - vertical.start.y) / 10;
  if (
    x < 0.0001 ||
    y < 0.0001 ||
    ![25, 50].includes(calibration.speed) ||
    ![5, 10, 20].includes(calibration.gain)
  )
    return undefined;
  if (
    Math.abs(horizontal.start.y - horizontal.end.y) > 0.000001 ||
    Math.abs(vertical.start.x - vertical.end.x) > 0.000001
  )
    return undefined;
  return { x, y };
}

export function validEcgPoint(point: EcgNormalizedPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

export function validEcgRegions(regions: readonly EcgLeadRegion[]): boolean {
  return (
    regions.length >= 12 &&
    regions.length <= 13 &&
    new Set(regions.map((r) => r.id)).size === regions.length &&
    ECG_STANDARD_LEADS.every((lead) => regions.some((r) => r.lead === lead)) &&
    regions.every(
      (r) =>
        validEcgPoint(r) &&
        Number.isFinite(r.width) &&
        Number.isFinite(r.height) &&
        r.width >= 0.01 &&
        r.height >= 0.01 &&
        r.x + r.width <= 1.000001 &&
        r.y + r.height <= 1.000001,
    )
  );
}

export function ecgRegionTemplate(
  layout: EcgEditorLayout,
  bounds: EcgNormalizedRegion = { x: 0.06, y: 0.12, width: 0.88, height: 0.8 },
): readonly EcgLeadRegion[] {
  if (layout === '12x1')
    return ECG_STANDARD_LEADS.map((lead, row) => ({
      id: lead,
      lead,
      x: bounds.x,
      y: bounds.y + (row * bounds.height) / 12,
      width: bounds.width,
      height: bounds.height / 12,
    }));
  const rows: readonly (readonly EcgLeadName[])[] = [
    ['I', 'aVR', 'V1', 'V4'],
    ['II', 'aVL', 'V2', 'V5'],
    ['III', 'aVF', 'V3', 'V6'],
  ];
  return [
    ...rows.flatMap((row, y) =>
      row.map((lead, x) => ({
        id: lead,
        lead,
        x: bounds.x + (x * bounds.width) / 4,
        y: bounds.y + (y * bounds.height) / 4,
        width: bounds.width / 4,
        height: bounds.height / 4,
      })),
    ),
    {
      id: 'rhythm-II',
      lead: 'II',
      x: bounds.x,
      y: bounds.y + bounds.height * 0.75,
      width: bounds.width,
      height: bounds.height / 4,
    },
  ];
}

export function moveEcgRegion(region: EcgLeadRegion, dx: number, dy: number): EcgLeadRegion {
  return {
    ...region,
    x: Math.max(0, Math.min(1 - region.width, region.x + dx)),
    y: Math.max(0, Math.min(1 - region.height, region.y + dy)),
  };
}

export function pointInsideEcgRegion(point: EcgNormalizedPoint, region: EcgLeadRegion): boolean {
  return (
    validEcgPoint(point) &&
    point.x >= region.x &&
    point.x <= region.x + region.width &&
    point.y >= region.y &&
    point.y <= region.y + region.height
  );
}

export function ecgRegionLabel(region: EcgLeadRegion): string {
  return region.id === 'rhythm-II' ? 'II · ритм' : region.lead;
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length / 2);
  const right = sorted[index];
  return right === undefined
    ? undefined
    : sorted.length % 2
      ? right
      : ((sorted[index - 1] ?? right) + right) / 2;
}

export interface EcgEditorMeasurements {
  readonly measurements: EcgMeasurements;
  readonly rAmplitudeMv?: number;
  readonly errors: readonly string[];
}

/** Measure one reviewed lead/complex; never combine unsynchronised printed lead fragments. */
export function measureEcgEditor(draft: EcgEditorDraft, regionId: string): EcgEditorMeasurements {
  const scale = ecgCalibrationScale(draft.calibration);
  const region = draft.regions.find((r) => r.id === regionId);
  if (!scale || !region)
    return { measurements: {}, errors: ['Проверьте калибровку и отведение для измерений.'] };
  const points = draft.points.filter(
    (p) => p.regionId === regionId && pointInsideEcgRegion(p, region),
  );
  const errors: string[] = [];
  const find = (kind: EcgPointKind): EcgEditorPoint | undefined => {
    const matches = points.filter((p) => p.kind === kind);
    if (matches.length > 1) {
      errors.push(`Оставьте одну точку «${ECG_POINT_LABELS[kind]}» для измеряемого комплекса.`);
      return undefined;
    }
    return matches[0];
  };
  const pairs: Partial<Record<EcgIntervalId, EcgPointPair>> = {};
  const pair = (
    id: EcgIntervalId,
    start: EcgEditorPoint | undefined,
    end: EcgEditorPoint | undefined,
  ): void => {
    if (!start || !end) return;
    if (end.x <= start.x) {
      errors.push(`Проверьте порядок границ ${id.toUpperCase()}.`);
      return;
    }
    pairs[id] = { start: start.x, end: end.x };
  };
  const pOnset = find('pOnset');
  const pOffset = find('pOffset');
  const qrsOnset = find('qrsOnset');
  const qrsOffset = find('qrsOffset');
  const tOffset = find('tOffset');
  pair('p', pOnset, pOffset);
  pair('pr', pOnset, qrsOnset);
  pair('qrs', qrsOnset, qrsOffset);
  if (tOffset && qrsOffset && tOffset.x <= qrsOffset.x)
    errors.push('Конец T должен быть после конца QRS.');
  else pair('qt', qrsOnset, tOffset);
  if (pOffset && qrsOnset && pOffset.x > qrsOnset.x)
    errors.push('Конец P не должен быть после начала QRS.');
  const rPeaks = points.filter((p) => p.kind === 'rPeak').sort((a, b) => a.x - b.x);
  const rr = median(rPeaks.slice(1).map((p, i) => p.x - (rPeaks[i]?.x ?? p.x)));
  if (rr !== undefined && rr <= 0)
    errors.push('Точки R должны обозначать разные последовательные комплексы.');
  else if (rr) pairs.rr = { start: 0, end: rr };
  const baseline = find('baseline');
  const representativeR = rPeaks.find(
    (p) => qrsOnset && qrsOffset && p.x >= qrsOnset.x && p.x <= qrsOffset.x,
  );
  if (qrsOnset && qrsOffset && !representativeR)
    errors.push('Между началом и концом QRS должна находиться вершина R этого комплекса.');
  const amplitude =
    baseline && representativeR
      ? (baseline.y - representativeR.y) / scale.y / draft.calibration.gain
      : undefined;
  return {
    measurements: errors.length
      ? {}
      : calculateEcgMeasurements(pairs, scale.x, draft.calibration.speed),
    ...(amplitude === undefined ? {} : { rAmplitudeMv: amplitude }),
    errors,
  };
}
