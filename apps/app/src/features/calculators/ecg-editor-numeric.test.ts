import { describe, expect, it } from 'vitest';
import { ecgNumericDraftFromEditor } from './ecg-editor-numeric';
import type {
  EcgEditorCalibration,
  EcgEditorDraft,
  EcgEditorPoint,
  EcgPointKind,
} from './ecgEditor';

// 25 mm spans x 0.1→0.35 (0.01 per mm); 10 mm spans y 0.1→0.2 (0.01 per mm).
const calibration = (speed: 25 | 50, gain: 5 | 10 | 20): EcgEditorCalibration => ({
  speed,
  gain,
  horizontal: { start: { x: 0.1, y: 0.1 }, end: { x: 0.35, y: 0.1 } },
  vertical: { start: { x: 0.1, y: 0.1 }, end: { x: 0.1, y: 0.2 } },
});

const region = (id: string, lead: EcgEditorDraft['regions'][number]['lead']) => ({
  id,
  lead,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

let nextId = 0;
const point = (
  regionId: string,
  kind: EcgPointKind,
  x: number,
  y: number,
  source: EcgEditorPoint['source'] = 'auto',
): EcgEditorPoint => {
  nextId += 1;
  return { id: String(nextId), regionId, kind, x, y, source };
};

// Baseline at y 0.5. R 10 mm above, Q 1 mm and S 3 mm below, T 2 mm above.
const complex = (regionId: string, source: EcgEditorPoint['source'] = 'auto') => [
  point(regionId, 'baseline', 0.27, 0.5, source),
  point(regionId, 'pOnset', 0.25, 0.5, source),
  point(regionId, 'pOffset', 0.275, 0.5, source),
  point(regionId, 'qrsOnset', 0.29, 0.5, source),
  point(regionId, 'qPeak', 0.293, 0.51, source),
  point(regionId, 'rPeak', 0.3, 0.4, source),
  point(regionId, 'sPeak', 0.308, 0.53, source),
  point(regionId, 'qrsOffset', 0.315, 0.5, source),
  point(regionId, 'tPeak', 0.37, 0.48, source),
  point(regionId, 'tOffset', 0.4, 0.5, source),
  point(regionId, 'rPeak', 0.55, 0.4, source),
];

const draft = (cal: EcgEditorCalibration, points: readonly EcgEditorPoint[]): EcgEditorDraft => ({
  calibration: cal,
  regions: [region('V5', 'V5'), region('II', 'II')],
  points,
});

describe('editor points to the 30-field numeric draft', () => {
  it.each([
    [5, 2, -0.2, -0.6, 0.4],
    [10, 1, -0.1, -0.3, 0.2],
    [20, 0.5, -0.05, -0.15, 0.1],
  ] as const)('converts baseline-relative amplitudes at %i mm/mV', (gain, r, q, s, t) => {
    const result = ecgNumericDraftFromEditor(
      { calibration: calibration(25, gain), regions: [region('V2', 'V2')], points: complex('V2') },
      'V2',
    );
    expect(result.amplitudes).toEqual({ R_Amp_V2: r, Q_Amp_V2: q, S_Amp_V2: s });
    const withT = ecgNumericDraftFromEditor(draft(calibration(25, gain), complex('V5')), 'V5');
    expect(withT.amplitudes).toMatchObject({ R_Amp_V5: r, T_Amp_V5: t });
  });

  it('keeps amplitudes independent of paper speed while intervals scale with it', () => {
    const slow = ecgNumericDraftFromEditor(draft(calibration(25, 10), complex('II')), 'II');
    const fast = ecgNumericDraftFromEditor(draft(calibration(50, 10), complex('II')), 'II');
    expect(slow.amplitudes.R_Amp_II).toBe(1);
    expect(fast.amplitudes.R_Amp_II).toBe(1);
    expect(slow.measurements).toMatchObject({ rrMs: 1000, qrsMs: 100, qtMs: 440, prMs: 160 });
    expect(fast.measurements).toMatchObject({ rrMs: 500, qrsMs: 50, qtMs: 220, prMs: 80 });
    expect(slow.sources.QRS_Dur_Global).toBe('Отведение II');
  });

  it('leaves absent leads and waves empty with the missing point named', () => {
    const points = complex('V5').filter((p) => p.kind !== 'qPeak');
    const result = ecgNumericDraftFromEditor(draft(calibration(25, 10), points), 'V5');
    expect(result.amplitudes.R_Amp_V1).toBeUndefined();
    expect(result.missing.R_Amp_V1).toBe('нет рамки отведения V1');
    expect(result.missing.R_Amp_II).toBe('II: нет точки «Изолиния»');
    // An unmarked Q is not a measured zero.
    expect(result.amplitudes.Q_Amp_V2).toBeUndefined();
    expect(result.amplitudes).not.toHaveProperty('Q_Amp_V5');
    expect(result.sources.R_Amp_V5).toBe('Отведение V5 · автоматические точки');
  });

  it('refuses ambiguous R peaks and unconfirmed calibration', () => {
    const noBounds = complex('V5').filter((p) => p.kind !== 'qrsOnset' && p.kind !== 'qrsOffset');
    expect(
      ecgNumericDraftFromEditor(draft(calibration(25, 10), noBounds), 'V5').missing.R_Amp_V5,
    ).toBe('V5: несколько вершин R — отметьте начало и конец измеряемого QRS');
    const { speed: _speed, ...unset } = calibration(25, 10);
    const result = ecgNumericDraftFromEditor(draft(unset, complex('V5')), 'V5');
    expect(result.amplitudes).toEqual({});
    expect(result.missing.R_Amp_V5).toBe('нет подтверждённой калибровки');
    expect(result.missing.RR_Mean_Global).toBe('нет подтверждённой калибровки');
  });

  it('reports manual corrections and prefers the measured region for its lead', () => {
    const regions = [region('II', 'II'), region('rhythm-II', 'II')];
    const points = [
      ...complex('rhythm-II', 'manual'),
      point('II', 'baseline', 0.27, 0.5),
      point('II', 'rPeak', 0.3, 0.45),
    ];
    const result = ecgNumericDraftFromEditor(
      { calibration: calibration(25, 10), regions, points },
      'rhythm-II',
    );
    expect(result.amplitudes.R_Amp_II).toBe(1);
    expect(result.sources.R_Amp_II).toBe('Отведение II · ритм · точки исправлены вручную');
  });
});
