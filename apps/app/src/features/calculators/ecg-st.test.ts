import { describe, expect, it } from 'vitest';
import type { EcgLeadName } from './ecg-model-contract';
import { type EcgLeadSt, evaluateEcgSt, measureEcgStByLead } from './ecg-st';
import type { EcgEditorDraft, EcgEditorPoint, EcgPointKind } from './ecgEditor';

const lead = (name: EcgLeadName, stMv: number, extra: Partial<EcgLeadSt> = {}): EcgLeadSt => ({
  lead: name,
  stMv,
  region: name,
  edited: false,
  ...extra,
});
const measured = (...leads: EcgLeadSt[]) => ({ leads, missing: {} });
const ids = (result: ReturnType<typeof evaluateEcgSt>) => result.findings.map((f) => f.id);

describe('ST at the J point against Fourth UDMI / ESC 2023 cut-points', () => {
  it('flags inferior elevation in two contiguous leads and the reciprocal lateral depression', () => {
    const result = evaluateEcgSt({
      measurement: measured(
        lead('II', 0.15),
        lead('III', 0.2),
        lead('aVF', 0.12),
        lead('I', -0.1),
        lead('aVL', 0.02),
      ),
      sex: 'male',
      ageBand: '40-plus',
    });
    expect(ids(result)).toEqual(['st-elevation', 'st-reciprocal-inferior-lateral']);
    expect(result.findings[0]?.leads).toEqual(['II', 'III', 'aVF']);
    expect(result.findings[0]?.text).toContain('II 1,5 мм, III 2,0 мм, aVF 1,2 мм');
    expect(result.findings[0]?.text).not.toMatch(/инфаркт/iu);
  });

  it('applies sex- and age-specific V2–V3 cut-points and the lowest one when unknown', () => {
    const v23 = measured(lead('V2', 0.18), lead('V3', 0.18));
    expect(ids(evaluateEcgSt({ measurement: v23, sex: 'male', ageBand: '40-plus' }))).toEqual([]);
    expect(ids(evaluateEcgSt({ measurement: v23, sex: 'male', ageBand: 'under-40' }))).toEqual([]);
    expect(ids(evaluateEcgSt({ measurement: v23, sex: 'female' }))).toEqual(['st-elevation']);
    const unknown = evaluateEcgSt({ measurement: v23 });
    expect(ids(unknown)).toEqual(['st-elevation']);
    expect(unknown.findings[0]?.text).toContain('самый низкий порог (1,5 мм)');
    expect(
      ids(
        evaluateEcgSt({
          measurement: measured(lead('V2', 0.2), lead('V3', 0.21)),
          sex: 'male',
          ageBand: '40-plus',
        }),
      ),
    ).toEqual(['st-elevation']);
    // 1 mm applies outside V2–V3.
    expect(
      ids(evaluateEcgSt({ measurement: measured(lead('V4', 0.1), lead('V5', 0.1)), sex: 'male' })),
    ).toEqual(['st-elevation']);
  });

  it('requires two contiguous leads: single or non-adjacent precordial leads do not qualify', () => {
    expect(ids(evaluateEcgSt({ measurement: measured(lead('II', 0.3)) }))).toEqual([]);
    expect(
      ids(
        evaluateEcgSt({
          measurement: measured(lead('V1', 0.3), lead('V2', 0.05), lead('V3', 0.3)),
          sex: 'female',
        }),
      ),
    ).toEqual([]);
    expect(
      ids(evaluateEcgSt({ measurement: measured(lead('II', 0.3), lead('aVL', 0.3)) })),
    ).toEqual([]);
  });

  it('reports ST depression and T inversion with R/S > 1 as separate review findings', () => {
    const result = evaluateEcgSt({
      measurement: measured(
        lead('V4', -0.06),
        lead('V5', -0.05, { rMv: 1.2, sMv: -0.2, tMv: -0.2 }),
        lead('V6', 0, { rMv: 1, sMv: -0.1, tMv: -0.15 }),
      ),
    });
    expect(ids(result)).toEqual(['st-depression', 't-inversion']);
    expect(result.findings[1]?.leads).toEqual(['V5', 'V6']);
    const lowR = evaluateEcgSt({
      measurement: measured(
        lead('V5', 0, { rMv: 0.2, sMv: -0.5, tMv: -0.2 }),
        lead('V6', 0, { rMv: 0.2, sMv: -0.5, tMv: -0.2 }),
      ),
    });
    expect(ids(lowR)).toEqual([]);
  });

  it('abstains on wide QRS and lists unmeasured leads', () => {
    const result = evaluateEcgSt({
      measurement: { leads: [lead('II', 0.3), lead('III', 0.3)], missing: { V1: 'нет рамки' } },
      qrsMs: 132,
    });
    expect(ids(result)).toEqual(['st-wide-qrs', 'st-missing']);
    expect(result.findings[0]?.text).toContain('QRS 132 мс');
    expect(result.scope).toContain('отсутствие находок не исключает');
  });
});

describe('ST measurement from editor points', () => {
  let id = 0;
  const point = (regionId: string, kind: EcgPointKind, y: number): EcgEditorPoint => {
    id += 1;
    return { id: String(id), regionId, kind, x: 0.3 + id * 0.001, y, source: 'auto' };
  };
  const draft = (gain: 5 | 10 | 20, points: EcgEditorPoint[]): EcgEditorDraft => ({
    calibration: {
      speed: 25,
      gain,
      horizontal: { start: { x: 0.1, y: 0.1 }, end: { x: 0.35, y: 0.1 } },
      vertical: { start: { x: 0.1, y: 0.1 }, end: { x: 0.1, y: 0.2 } },
    },
    regions: [
      { id: 'II', lead: 'II', x: 0, y: 0, width: 1, height: 1 },
      { id: 'V1', lead: 'V1', x: 0, y: 0, width: 1, height: 1 },
    ],
    points,
  });

  it('measures J relative to the isoelectric baseline in mV at every gain', () => {
    // J is 2 mm above the baseline.
    const points = [point('II', 'baseline', 0.5), point('II', 'qrsOffset', 0.48)];
    expect(measureEcgStByLead(draft(10, points), 'II').leads[0]?.stMv).toBe(0.2);
    expect(measureEcgStByLead(draft(5, points), 'II').leads[0]?.stMv).toBe(0.4);
    expect(measureEcgStByLead(draft(20, points), 'II').leads[0]?.stMv).toBe(0.1);
  });

  it('names the missing baseline or J point instead of guessing', () => {
    const result = measureEcgStByLead(draft(10, [point('V1', 'baseline', 0.5)]), 'II');
    expect(result.missing.II).toBe('II: нет точки «Изолиния»');
    expect(result.missing.V1).toBe('V1: нет точки «Конец QRS (точка J)»');
    expect(result.missing.V6).toBe('нет рамки отведения V6');
  });
});
