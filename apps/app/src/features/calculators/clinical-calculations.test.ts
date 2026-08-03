import { describe, expect, it } from 'vitest';

import {
  calculateAdultEgfrCkdEpi2021,
  calculateMostellerBsa,
  calculatePediatricEgfrSchwartz2009,
  calculatePediatricMaintenanceFluids,
} from '@/features/calculators/clinical-calculations';

describe('clinical calculations', () => {
  it('calculates Mosteller body surface area without hidden rounding', () => {
    const result = calculateMostellerBsa({ heightCm: 170, weightKg: 70 });
    expect(result.ok).toBe(true);
    if (!result.ok || !('value' in result)) throw new Error('expected numeric result');
    expect(result.value).toBeCloseTo(1.8181186858, 9);
    expect(result.displayPrecision).toBe(2);
  });

  it('calculates CKD-EPI 2021 and accepts creatinine in either unit', () => {
    const mg = calculateAdultEgfrCkdEpi2021({
      ageYears: 50,
      sex: 'male',
      creatinine: 1,
      creatinineUnit: 'mg/dl',
    });
    const umol = calculateAdultEgfrCkdEpi2021({
      ageYears: 50,
      sex: 'male',
      creatinine: 88.4,
      creatinineUnit: 'umol/l',
    });
    expect(mg.ok).toBe(true);
    expect(umol.ok).toBe(true);
    if (!mg.ok || !umol.ok || !('value' in mg) || !('value' in umol)) {
      throw new Error('expected numeric results');
    }
    expect(mg.value).toBeCloseTo(91.6914786098, 8);
    expect(umol.value).toBeCloseTo(mg.value, 10);
  });

  it('rejects CKD-EPI for children', () => {
    expect(
      calculateAdultEgfrCkdEpi2021({
        ageYears: 12,
        sex: 'female',
        creatinine: 0.6,
        creatinineUnit: 'mg/dl',
      }),
    ).toMatchObject({ ok: false });
  });

  it('calculates bedside CKiD 2009 and enforces its source population', () => {
    const result = calculatePediatricEgfrSchwartz2009({
      ageYears: 8,
      heightCm: 120,
      creatinine: 0.6,
      creatinineUnit: 'mg/dl',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !('value' in result)) throw new Error('expected numeric result');
    expect(result.value).toBeCloseTo(82.6, 8);
    expect(
      calculatePediatricEgfrSchwartz2009({
        ageYears: 0.5,
        heightCm: 65,
        creatinine: 0.3,
        creatinineUnit: 'mg/dl',
      }),
    ).toMatchObject({ ok: false });
  });

  it('keeps daily Holliday–Segar and hourly 4-2-1 outputs separate', () => {
    const result = calculatePediatricMaintenanceFluids({ weightKg: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok || !('values' in result)) throw new Error('expected multi-value result');
    expect(result.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 1600, unit: 'мл/сут' }),
        expect.objectContaining({ value: 65, unit: 'мл/ч' }),
      ]),
    );
    expect(result.values.find((item) => item.label.startsWith('Средняя'))?.value).toBeCloseTo(
      66.6666666667,
      8,
    );
  });
});
