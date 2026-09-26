import { describe, expect, it } from 'vitest';
import { calculateEcgPatientAge, type EcgKnownPatientAge } from './ecg-patient-age';
import {
  ECG_PEDIATRIC_NORM_GROUPS,
  ECG_PEDIATRIC_NORMS,
  ecgPediatricNormGroup,
  evaluateEcgPediatricNorms,
} from './ecg-pediatric-norms';

const limits = (id: string, sex: 'boys' | 'girls', group: string) => {
  const index = ECG_PEDIATRIC_NORM_GROUPS.findIndex((item) => item.id === group);
  return ECG_PEDIATRIC_NORMS.find((parameter) => parameter.id === id)?.[sex][index];
};
const statusOf = (result: ReturnType<typeof evaluateEcgPediatricNorms>, id: string) =>
  result.covered ? result.flags.find((flag) => flag.id === id)?.status : undefined;

describe('Rijnbeek 2001 paediatric reference limits', () => {
  it('keeps the printed values of Tables 3.2, 3.5 and 3.6', () => {
    expect(ECG_PEDIATRIC_NORM_GROUPS).toHaveLength(9);
    for (const parameter of ECG_PEDIATRIC_NORMS) {
      expect(parameter.boys).toHaveLength(9);
      expect(parameter.girls).toHaveLength(9);
    }
    expect(limits('heartRate', 'girls', 'm1-3')).toEqual([126, 200]);
    expect(limits('qrsMs', 'boys', 'y8-12')).toEqual([67, 103]);
    expect(limits('qtcBazettMs', 'girls', 'y12-16')).toEqual([370, 457]);
    expect(limits('rV6Mv', 'boys', 'y12-16')).toEqual([null, 3.05]);
    expect(limits('rV6Mv', 'girls', 'y12-16')).toEqual([null, 2.52]);
    expect(limits('sV1Mv', 'girls', 'y8-12')).toEqual([null, 2.58]);
    expect(limits('qrsAxisDeg', 'boys', 'd11-30')).toEqual([75, 140]);
  });

  it('flags values below the 2nd or above the 98th percentile for age and sex', () => {
    const toddler = evaluateEcgPediatricNorms({
      group: 'y1-3',
      sex: 'male',
      values: { heartRate: 160, prMs: 85, qrsMs: 70, rV1Mv: 1.5 },
    });
    expect(statusOf(toddler, 'heartRate')).toBe('above');
    expect(statusOf(toddler, 'prMs')).toBe('below');
    expect(statusOf(toddler, 'qrsMs')).toBe('within');
    expect(statusOf(toddler, 'rV1Mv')).toBe('within');
    expect(toddler.covered && toddler.missing).toEqual([
      'QTc Bazett',
      'Ось QRS',
      'S в V1',
      'R в V6',
      'S в V6',
    ]);
    const flag = toddler.covered
      ? toddler.flags.find((item) => item.id === 'heartRate')
      : undefined;
    expect(flag?.text).toContain('выше 98-го перцентиля для возраста 1–3 года');
    expect(flag?.text).not.toMatch(/гипертроф|блокад|диагноз:/iu);
  });

  it('compares S depth by magnitude and uses the union of both sexes when sex is unknown', () => {
    expect(
      statusOf(
        evaluateEcgPediatricNorms({ group: 'y8-12', sex: 'female', values: { sV1Mv: -2.6 } }),
        'sV1Mv',
      ),
    ).toBe('above');
    const unknown = evaluateEcgPediatricNorms({ group: 'y12-16', values: { qrsMs: 108 } });
    expect(statusOf(unknown, 'qrsMs')).toBe('within');
    expect(unknown.covered && unknown.note).toContain('пол не указан');
    expect(
      statusOf(
        evaluateEcgPediatricNorms({ group: 'y12-16', sex: 'female', values: { qrsMs: 108 } }),
        'qrsMs',
      ),
    ).toBe('above');
  });

  it('abstains with an explanation under 11 days and at 16–17 years', () => {
    const newborn = evaluateEcgPediatricNorms({ group: 'd0-10', values: { heartRate: 150 } });
    expect(newborn.covered).toBe(false);
    expect(!newborn.covered && newborn.text).toContain('нет детей первых 10 дней');
    const teen = evaluateEcgPediatricNorms({ group: 'y16-17', values: { qrsMs: 120 } });
    expect(!teen.covered && teen.text).toContain('оцените по взрослым с осторожностью');
  });

  it('maps an exact calendar age onto the Rijnbeek groups, including the 10/11-day edge', () => {
    const at = (ecgDate: string) =>
      calculateEcgPatientAge({ dateOfBirth: '2026-01-01', ecgDate }) as EcgKnownPatientAge;
    expect(ecgPediatricNormGroup(at('2026-01-11'))).toBe('d0-10');
    expect(ecgPediatricNormGroup(at('2026-01-12'))).toBe('d11-30');
    expect(ecgPediatricNormGroup(at('2026-03-15'))).toBe('m1-3');
    expect(ecgPediatricNormGroup(at('2041-06-01'))).toBe('y12-16');
    expect(ecgPediatricNormGroup(at('2043-01-01'))).toBe('y16-17');
    expect(ecgPediatricNormGroup(at('2044-01-01'))).toBeUndefined();
  });
});
