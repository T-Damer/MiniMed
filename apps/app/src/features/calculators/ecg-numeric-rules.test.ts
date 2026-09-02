import { describe, expect, it } from 'vitest';

import {
  crossCheckEcgEstimatesWithRules,
  interpretEcgNumericRules,
} from '@/features/calculators/ecg-numeric-rules';

describe('numeric ECG rules', () => {
  it('classifies adult QRS-axis boundaries without inferring their cause', () => {
    expect(
      [-180, -91, -90, -31, -30, 90, 91, 180].map(
        (qrsAxisDegrees) =>
          interpretEcgNumericRules({
            ageYears: 40,
            measurementsConfirmed: true,
            qrsAxisDegrees,
            values: {},
          })[0]?.id,
      ),
    ).toEqual([
      'qrs-axis-extreme',
      'qrs-axis-extreme',
      'qrs-axis-left',
      'qrs-axis-left',
      'qrs-axis-normal',
      'qrs-axis-normal',
      'qrs-axis-right',
      'qrs-axis-extreme',
    ]);
  });

  it('matches Sokolow–Lyon only above 3.5 mV and keeps a negative result non-exclusionary', () => {
    const matched = interpretEcgNumericRules({
      ageYears: 55,
      measurementsConfirmed: true,
      values: { S_Amp_V1: -1.6, R_Amp_V5: 1.8, R_Amp_V6: 2 },
    });
    expect(matched[0]).toMatchObject({ id: 'sokolow-lyon-matched', status: 'finding' });
    expect(matched[0]?.evidence).toContain('сумма 3.6 мВ');

    const boundary = interpretEcgNumericRules({
      ageYears: 55,
      measurementsConfirmed: true,
      values: { S_Amp_V1: -1.5, R_Amp_V5: 2, R_Amp_V6: 1.9 },
    });
    expect(boundary[0]).toMatchObject({ id: 'sokolow-lyon-not-matched', status: 'normal' });
    expect(boundary[0]?.text).toMatch(/не исключает/i);
  });

  it('requires an adult age and all three voltage measurements', () => {
    expect(() =>
      interpretEcgNumericRules({ ageYears: 17, measurementsConfirmed: true, values: {} }),
    ).toThrow('18–120');
    expect(
      interpretEcgNumericRules({
        ageYears: 40,
        measurementsConfirmed: true,
        values: { S_Amp_V1: -1.5, R_Amp_V5: 2 },
      }),
    ).toEqual([]);
  });

  it('abstains from every numeric rule until the measurements are confirmed', () => {
    expect(
      interpretEcgNumericRules({
        ageYears: 40,
        measurementsConfirmed: false,
        qrsAxisDegrees: -60,
        values: { S_Amp_V1: -1.6, R_Amp_V5: 2 },
      }),
    ).toEqual([]);
  });

  it('reports LAFB only when every adult criterion and suppression is confirmed', () => {
    const input = {
      ageYears: 40,
      avlRPeakTimeMs: 45,
      measurementsConfirmed: true,
      qrsAxisDegrees: -45,
      values: { QRS_Dur_Global: 119.9 },
      morphology: {
        avlQrPattern: 'present',
        inferiorRsPattern: 'present',
        dominantQrsSupraventricular: 'present',
        pacedQrs: 'absent',
        deltaWave: 'absent',
      },
    } as const;

    expect(interpretEcgNumericRules(input).map((finding) => finding.id)).toContain(
      'lafb-compatible-pattern',
    );
    expect(
      interpretEcgNumericRules({ ...input, qrsAxisDegrees: -90 }).map((finding) => finding.id),
    ).toContain('lafb-compatible-pattern');

    for (const excluded of [
      { ...input, qrsAxisDegrees: -44.9 },
      { ...input, qrsAxisDegrees: -90.1 },
      { ...input, avlRPeakTimeMs: 44.9 },
      { ...input, values: { QRS_Dur_Global: 120 } },
      { ...input, morphology: { ...input.morphology, avlQrPattern: 'unknown' as const } },
      { ...input, morphology: { ...input.morphology, pacedQrs: 'present' as const } },
      { ...input, morphology: { ...input.morphology, deltaWave: 'unknown' as const } },
    ]) {
      expect(interpretEcgNumericRules(excluded).map((finding) => finding.id)).not.toContain(
        'lafb-compatible-pattern',
      );
    }
  });

  it('explains rather than suppresses disagreements between model classes and rules', () => {
    const checks = crossCheckEcgEstimatesWithRules({
      estimates: [
        { id: 'NORM', status: 'positive' },
        { id: 'CD', status: 'positive' },
        { id: 'HYP', status: 'positive' },
        { id: 'MI', status: 'negative' },
      ],
      hasDeterministicFinding: true,
      qrsWide: false,
      sokolowLyon: 'not-matched',
    });

    expect(checks.map((check) => check.id)).toEqual([
      'norm-with-measured-findings',
      'cd-wide-qrs-not-supported',
      'hyp-sokolow-not-supported',
    ]);
    expect(checks.every((check) => check.status === 'limits')).toBe(true);

    expect(
      crossCheckEcgEstimatesWithRules({
        estimates: [
          { id: 'CD', status: 'positive' },
          { id: 'HYP', status: 'positive' },
        ],
        hasDeterministicFinding: true,
        qrsWide: true,
        sokolowLyon: 'matched',
      }).map((check) => check.id),
    ).toEqual(['cd-wide-qrs-supported', 'hyp-sokolow-supported']);
  });
});
