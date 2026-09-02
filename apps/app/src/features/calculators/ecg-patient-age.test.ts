import { describe, expect, it } from 'vitest';

import {
  calculateEcgPatientAge,
  ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
  getEcgPediatricQrsReferenceFlag,
} from '@/features/calculators/ecg-patient-age';

function age(dateOfBirth: string, ecgDate: string) {
  return calculateEcgPatientAge({ dateOfBirth, ecgDate });
}

describe('ECG patient age routing', () => {
  it('calculates exact days and full calendar years across a leap day', () => {
    expect(age('2020-02-29', '2024-02-29')).toEqual({
      ageDays: 1_461,
      ageYears: 4,
      group: '3–5y',
      route: 'pediatric',
    });
    expect(age('2020-02-29', '2024-02-28')).toMatchObject({
      ageDays: 1_460,
      ageYears: 3,
      route: 'pediatric',
    });
  });

  it('keeps missing, invalid, reversed, and over-120 inputs unknown', () => {
    expect(age('', '')).toEqual({ reason: 'missing-date', route: 'unknown' });
    expect(age('2020-02-30', '2020-03-01')).toEqual({
      reason: 'invalid-date',
      route: 'unknown',
    });
    expect(age('2020-03-01', '2020-02-29')).toEqual({
      reason: 'before-birth',
      route: 'unknown',
    });
    expect(age('1900-01-01', '2020-01-01')).toMatchObject({
      ageYears: 120,
      route: 'adult',
    });
    expect(age('1900-01-01', '2020-01-02')).toEqual({
      reason: 'over-120-years',
      route: 'unknown',
    });
  });

  it('uses every documented calendar age-group boundary', () => {
    const expected = [
      ['2020-01-01', '0–6d'],
      ['2020-01-07', '0–6d'],
      ['2020-01-08', '7–30d'],
      ['2020-01-31', '7–30d'],
      ['2020-02-01', '1–3mo'],
      ['2020-04-01', '3–6mo'],
      ['2020-07-01', '6–12mo'],
      ['2021-01-01', '1–3y'],
      ['2023-01-01', '3–5y'],
      ['2025-01-01', '5–8y'],
      ['2028-01-01', '8–12y'],
      ['2032-01-01', '12–16y'],
      ['2036-01-01', '16–17y'],
      ['2038-01-01', 'adult 18+'],
    ] as const;

    for (const [ecgDate, group] of expected) {
      expect(age('2020-01-01', ecgDate).group).toBe(group);
    }
    expect(age('2020-01-01', '2037-12-31').route).toBe('pediatric');
    expect(age('2020-01-01', '2038-01-01')).toMatchObject({
      ageYears: 18,
      group: 'adult 18+',
      route: 'adult',
    });
  });

  it('applies only the attributed pediatric QRS thresholds', () => {
    const underFour = age('2020-01-01', '2023-01-01');
    expect(getEcgPediatricQrsReferenceFlag(underFour, 89)).toEqual({
      qrsMs: 89,
      sourceUrl: ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
      status: 'below-reference',
      thresholdMs: 90,
    });
    expect(getEcgPediatricQrsReferenceFlag(underFour, 90).status).toBe('at-or-above-reference');

    const fourToSixteen = age('2020-01-01', '2024-01-01');
    expect(getEcgPediatricQrsReferenceFlag(fourToSixteen, 99).thresholdMs).toBe(100);
    expect(getEcgPediatricQrsReferenceFlag(fourToSixteen, 100).status).toBe(
      'at-or-above-reference',
    );
    expect(getEcgPediatricQrsReferenceFlag(underFour).status).toBe('unavailable');
  });

  it('does not invent a threshold for the 16–17 transition or adults', () => {
    const transition = age('2020-01-01', '2036-01-01');
    expect(transition).toMatchObject({ group: '16–17y', route: 'pediatric' });
    expect(getEcgPediatricQrsReferenceFlag(transition, 180)).toEqual({
      sourceUrl: ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
      status: 'not-applied',
    });
    expect(getEcgPediatricQrsReferenceFlag(age('2020-01-01', '2038-01-01'), 180)).toEqual({
      sourceUrl: ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
      status: 'not-applicable',
    });
  });
});
