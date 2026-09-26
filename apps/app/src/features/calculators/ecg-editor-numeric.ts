import type { EcgLeadName } from './ecg-model-contract';
import { ECG_NUMERIC_FEATURES, type EcgNumericFeatureId } from './ecg-numeric-inference';
import type { EcgMeasurements } from './ecg-photo-caliper';
import {
  ECG_POINT_LABELS,
  type EcgEditorDraft,
  type EcgEditorPoint,
  type EcgLeadRegion,
  type EcgPointKind,
  ecgCalibrationScale,
  ecgRegionLabel,
  measureEcgEditor,
  pointInsideEcgRegion,
} from './ecgEditor';

export interface EcgEditorNumericDraft {
  readonly measurements: EcgMeasurements;
  readonly amplitudes: Partial<Record<EcgNumericFeatureId, number>>;
  /** Why a field stayed empty; nothing is imputed, including a zero for an absent Q wave. */
  readonly missing: Partial<Record<EcgNumericFeatureId, string>>;
  /** Where a filled value came from, so the clinician can check it against the photo. */
  readonly sources: Partial<Record<EcgNumericFeatureId, string>>;
}

type Wave = 'Q' | 'R' | 'S' | 'T';

const WAVE_POINT: Readonly<Record<Wave, EcgPointKind>> = {
  Q: 'qPeak',
  R: 'rPeak',
  S: 'sPeak',
  T: 'tPeak',
};

const INTERVALS: readonly {
  readonly id: EcgNumericFeatureId;
  readonly key: keyof EcgMeasurements;
  readonly needs: string;
}[] = [
  { id: 'P_Dur_Global', key: 'pDurationMs', needs: 'начало и конец P' },
  { id: 'PR_Int_Global', key: 'prMs', needs: 'начало P и начало QRS' },
  { id: 'QRS_Dur_Global', key: 'qrsMs', needs: 'начало и конец QRS' },
  { id: 'QT_Int_Global', key: 'qtMs', needs: 'начало QRS и конец T' },
  { id: 'QT_IntFramingham_Global', key: 'qtcFraminghamMs', needs: 'QT и минимум две вершины R' },
  { id: 'RR_Mean_Global', key: 'rrMs', needs: 'минимум две соседние вершины R' },
];

export type Lookup =
  | { readonly point: EcgEditorPoint; readonly error?: undefined }
  | { readonly point?: undefined; readonly error: string };

export function pointsIn(draft: EcgEditorDraft, region: EcgLeadRegion): readonly EcgEditorPoint[] {
  return draft.points.filter((p) => p.regionId === region.id && pointInsideEcgRegion(p, region));
}

export function single(points: readonly EcgEditorPoint[], kind: EcgPointKind): Lookup {
  const matches = points.filter((p) => p.kind === kind);
  if (matches.length === 1 && matches[0]) return { point: matches[0] };
  return {
    error: matches.length
      ? `несколько точек «${ECG_POINT_LABELS[kind]}» — оставьте одну`
      : `нет точки «${ECG_POINT_LABELS[kind]}»`,
  };
}

export function rPeak(points: readonly EcgEditorPoint[]): Lookup {
  const peaks = points.filter((p) => p.kind === 'rPeak');
  const onset = points.filter((p) => p.kind === 'qrsOnset');
  const offset = points.filter((p) => p.kind === 'qrsOffset');
  if (onset.length === 1 && offset.length === 1 && onset[0] && offset[0]) {
    const start = onset[0].x;
    const end = offset[0].x;
    const inside = peaks.filter((p) => p.x >= start && p.x <= end);
    if (inside.length === 1 && inside[0]) return { point: inside[0] };
    return { error: 'между началом и концом QRS нужна одна вершина R' };
  }
  if (peaks.length === 1 && peaks[0]) return { point: peaks[0] };
  return {
    error: peaks.length
      ? 'несколько вершин R — отметьте начало и конец измеряемого QRS'
      : 'нет точки «Вершина R»',
  };
}

/** Standard lead region first; the measured region wins when it shows the same lead. */
export function candidateRegions(
  draft: EcgEditorDraft,
  lead: EcgLeadName,
  measuredRegionId: string,
): readonly EcgLeadRegion[] {
  return draft.regions
    .filter((region) => region.lead === lead)
    .sort(
      (a, b) =>
        Number(b.id === measuredRegionId) - Number(a.id === measuredRegionId) ||
        Number(b.id === lead) - Number(a.id === lead),
    );
}

/**
 * Drafts the 30 numeric-model fields from reviewed editor points. Intervals come from the measured
 * lead; each amplitude is the signed distance from that lead's own baseline point in mV.
 */
export function ecgNumericDraftFromEditor(
  draft: EcgEditorDraft,
  measuredRegionId: string,
): EcgEditorNumericDraft {
  const amplitudes: Partial<Record<EcgNumericFeatureId, number>> = {};
  const missing: Partial<Record<EcgNumericFeatureId, string>> = {};
  const sources: Partial<Record<EcgNumericFeatureId, string>> = {};
  const scale = ecgCalibrationScale(draft.calibration);
  const measured = measureEcgEditor(draft, measuredRegionId);
  const measuredRegion = draft.regions.find((region) => region.id === measuredRegionId);
  const measuredLabel = measuredRegion ? ecgRegionLabel(measuredRegion) : 'не выбрано';

  for (const interval of INTERVALS) {
    const value = measured.measurements[interval.key];
    if (value !== undefined) sources[interval.id] = `Отведение ${measuredLabel}`;
    else
      missing[interval.id] = !scale
        ? 'нет подтверждённой калибровки'
        : (measured.errors[0] ?? `нужны точки: ${interval.needs} в отведении ${measuredLabel}`);
  }

  for (const feature of ECG_NUMERIC_FEATURES.slice(6)) {
    const match = /^(Q|R|S|T)_Amp_(.+)$/u.exec(feature.id);
    const wave = match?.[1] as Wave | undefined;
    const lead = match?.[2] as EcgLeadName | undefined;
    if (!wave || !lead) continue;
    if (!scale) {
      missing[feature.id] = 'нет подтверждённой калибровки';
      continue;
    }
    const regions = candidateRegions(draft, lead, measuredRegionId);
    if (!regions.length) {
      missing[feature.id] = `нет рамки отведения ${lead}`;
      continue;
    }
    let firstError: string | undefined;
    for (const region of regions) {
      const points = pointsIn(draft, region);
      const baseline = single(points, 'baseline');
      const peak = wave === 'R' ? rPeak(points) : single(points, WAVE_POINT[wave]);
      if (baseline.point && peak.point) {
        amplitudes[feature.id] =
          Math.round(((baseline.point.y - peak.point.y) / scale.y / scale.gain) * 100) / 100;
        const edited = [baseline.point, peak.point].some((p) => p.source === 'manual');
        sources[feature.id] =
          `Отведение ${ecgRegionLabel(region)} · ${edited ? 'точки исправлены вручную' : 'автоматические точки'}`;
        firstError = undefined;
        break;
      }
      firstError ??= `${ecgRegionLabel(region)}: ${baseline.error ?? peak.error}`;
    }
    if (firstError) missing[feature.id] = firstError;
  }

  return { measurements: measured.measurements, amplitudes, missing, sources };
}
