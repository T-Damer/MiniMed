import { describe, expect, it } from 'vitest';

import {
  ADULT_EGFR_CKD_EPI_2021_SCHEMA,
  BODY_SURFACE_AREA_MOSTELLER_SCHEMA,
  CALCULATOR_SCHEMA_BY_ID,
  CALCULATOR_SCHEMA_CATALOG,
  PEDIATRIC_EGFR_SCHWARTZ_2009_SCHEMA,
  PEDIATRIC_MAINTENANCE_FLUIDS_SCHEMA,
} from '@/features/calculators/calculator-schema-catalog';
import type {
  CalculatorSchemaNumberOutput,
  CalculatorSchemaOutput,
} from '@/features/calculators/calculator-schema-engine';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import {
  calculateAdultEgfrCkdEpi2021,
  calculateMostellerBsa,
  calculatePediatricEgfrSchwartz2009,
  calculatePediatricMaintenanceFluids,
} from '@/features/calculators/clinical-calculations';

function expectNumberOutput(
  output: CalculatorSchemaOutput | undefined,
): asserts output is CalculatorSchemaNumberOutput {
  if (output?.kind !== 'number') throw new Error('expected a numeric schema output');
}

describe('calculator schema catalog', () => {
  it('ids match the live CALCULATOR_REGISTRY ids (no accidental rename/drift)', () => {
    expect(CALCULATOR_SCHEMA_CATALOG.map((schema) => schema.id).toSorted()).toEqual(
      [
        'adult-egfr-ckd-epi-2021',
        'body-surface-area-mosteller',
        'pediatric-egfr-schwartz-2009',
        'pediatric-maintenance-fluids',
        'obstetric-bishop-score',
        'obstetric-ga-crl',
        'obstetric-edd-lmp',
        'obstetric-edd-ultrasound',
        'obstetric-edd-conception',
        'obstetric-edd-quickening',
        'obstetric-edd-given-date',
        'obstetric-ga-from-edd',
        'obstetric-maternity-leave',
      ].toSorted(),
    );
  });

  it('CALCULATOR_SCHEMA_BY_ID looks up every catalog entry by id', () => {
    for (const schema of CALCULATOR_SCHEMA_CATALOG) {
      expect(CALCULATOR_SCHEMA_BY_ID.get(schema.id)).toBe(schema);
    }
  });
});

describe('body surface area schema matches the hardcoded Mosteller implementation', () => {
  it.each([
    { heightCm: 180, weightKg: 75 },
    { heightCm: 50, weightKg: 3.2 }, // newborn-scale
    { heightCm: 260, weightKg: 500 }, // upper bound
  ])('%o', ({ heightCm, weightKg }) => {
    const legacy = calculateMostellerBsa({ heightCm, weightKg });
    const schemaResult = evaluateCalculatorSchema(BODY_SURFACE_AREA_MOSTELLER_SCHEMA, {
      heightCm,
      weightKg,
    });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('value' in legacy)) throw new Error('unreachable');
    expectNumberOutput(schemaResult.outputs[0]);
    expect(schemaResult.outputs[0].value).toBeCloseTo(legacy.value, 10);
    expect(schemaResult.outputs[0].unit).toBe(legacy.unit);
  });

  it('rejects out-of-range height the same way the input bounds describe', () => {
    const result = evaluateCalculatorSchema(BODY_SURFACE_AREA_MOSTELLER_SCHEMA, {
      heightCm: 300,
      weightKg: 70,
    });
    expect(result.ok).toBe(false);
  });
});

describe('adult eGFR CKD-EPI 2021 schema matches the hardcoded implementation', () => {
  it.each([
    { ageYears: 42, sex: 'female' as const, creatinine: 0.9, creatinineUnit: 'mg/dl' as const },
    { ageYears: 65, sex: 'male' as const, creatinine: 90, creatinineUnit: 'umol/l' as const },
    { ageYears: 18, sex: 'female' as const, creatinine: 1.4, creatinineUnit: 'mg/dl' as const },
  ])('%o', ({ ageYears, sex, creatinine, creatinineUnit }) => {
    const legacy = calculateAdultEgfrCkdEpi2021({ ageYears, sex, creatinine, creatinineUnit });
    const schemaResult = evaluateCalculatorSchema(ADULT_EGFR_CKD_EPI_2021_SCHEMA, {
      ageYears,
      sex,
      creatinine,
      creatinineUnit,
    });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('value' in legacy)) throw new Error('unreachable');
    expectNumberOutput(schemaResult.outputs[0]);
    expect(schemaResult.outputs[0].value).toBeCloseTo(legacy.value, 8);
    expect(schemaResult.outputs[0].unit).toBe(legacy.unit);
  });

  it('rejects missing required inputs', () => {
    const result = evaluateCalculatorSchema(ADULT_EGFR_CKD_EPI_2021_SCHEMA, {
      ageYears: 40,
      sex: 'female',
      creatinineUnit: 'mg/dl',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an age outside the declared input bounds', () => {
    const result = evaluateCalculatorSchema(ADULT_EGFR_CKD_EPI_2021_SCHEMA, {
      ageYears: 12,
      sex: 'female',
      creatinine: 0.9,
      creatinineUnit: 'mg/dl',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects implausible creatinine via the new assertions mechanism, matching the hardcoded >30 mg/dl guard', () => {
    const legacy = calculateAdultEgfrCkdEpi2021({
      ageYears: 40,
      sex: 'female',
      creatinine: 35,
      creatinineUnit: 'mg/dl',
    });
    const schemaResult = evaluateCalculatorSchema(ADULT_EGFR_CKD_EPI_2021_SCHEMA, {
      ageYears: 40,
      sex: 'female',
      creatinine: 35,
      creatinineUnit: 'mg/dl',
    });
    expect(legacy.ok).toBe(false);
    expect(schemaResult.ok).toBe(false);
  });
});

describe('pediatric eGFR Schwartz 2009 schema matches the hardcoded implementation', () => {
  it.each([
    { ageYears: 8, heightCm: 120, creatinine: 0.5, creatinineUnit: 'mg/dl' as const },
    { ageYears: 2, heightCm: 85, creatinine: 40, creatinineUnit: 'umol/l' as const },
  ])('%o', ({ ageYears, heightCm, creatinine, creatinineUnit }) => {
    const legacy = calculatePediatricEgfrSchwartz2009({
      ageYears,
      heightCm,
      creatinine,
      creatinineUnit,
    });
    const schemaResult = evaluateCalculatorSchema(PEDIATRIC_EGFR_SCHWARTZ_2009_SCHEMA, {
      ageYears,
      heightCm,
      creatinine,
      creatinineUnit,
    });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('value' in legacy)) throw new Error('unreachable');
    expectNumberOutput(schemaResult.outputs[0]);
    expect(schemaResult.outputs[0].value).toBeCloseTo(legacy.value, 8);
    expect(schemaResult.outputs[0].unit).toBe(legacy.unit);
  });

  it('rejects implausible creatinine via assertions, matching the hardcoded >20 mg/dl guard', () => {
    const legacy = calculatePediatricEgfrSchwartz2009({
      ageYears: 8,
      heightCm: 120,
      creatinine: 25,
      creatinineUnit: 'mg/dl',
    });
    const schemaResult = evaluateCalculatorSchema(PEDIATRIC_EGFR_SCHWARTZ_2009_SCHEMA, {
      ageYears: 8,
      heightCm: 120,
      creatinine: 25,
      creatinineUnit: 'mg/dl',
    });
    expect(legacy.ok).toBe(false);
    expect(schemaResult.ok).toBe(false);
  });
});

describe('pediatric maintenance fluids (Holliday-Segar) schema matches the hardcoded implementation', () => {
  it.each([{ weightKg: 5 }, { weightKg: 15 }, { weightKg: 35 }])('%o', ({ weightKg }) => {
    const legacy = calculatePediatricMaintenanceFluids({ weightKg });
    const schemaResult = evaluateCalculatorSchema(PEDIATRIC_MAINTENANCE_FLUIDS_SCHEMA, {
      weightKg,
    });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('values' in legacy)) throw new Error('unreachable');
    expect(schemaResult.outputs).toHaveLength(3);
    legacy.values.forEach((expected, index) => {
      expectNumberOutput(schemaResult.outputs[index]);
      expect(schemaResult.outputs[index].value).toBeCloseTo(expected.value, 8);
      expect(schemaResult.outputs[index].unit).toBe(expected.unit);
    });
  });
});
