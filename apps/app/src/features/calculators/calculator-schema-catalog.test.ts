import { describe, expect, it } from 'vitest';

import {
  getCalculatorSchema,
  registerDownloadedCalculatorSchema,
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
import {
  calculatorSchemaFromModules,
  loadToolModuleRecords,
} from '@/features/calculators/tool-module-test-helpers';

function expectNumberOutput(
  output: CalculatorSchemaOutput | undefined,
): asserts output is CalculatorSchemaNumberOutput {
  if (output?.kind !== 'number') throw new Error('expected a numeric schema output');
}

describe('calculator schema catalog', () => {
  it('has no bundled schemas until a tool module is registered', () => {
    expect(getCalculatorSchema('body-surface-area-mosteller')).toBeUndefined();
    const record = loadToolModuleRecords(['content/tool-modules/core-clinical.json']).find(
      (candidate) => candidate.id === 'body-surface-area-mosteller',
    );
    expect(record?.kind).toBe('calculator');
    if (record?.kind === 'calculator') {
      registerDownloadedCalculatorSchema(record);
      expect(getCalculatorSchema('body-surface-area-mosteller')?.slug).toBe(
        'body-surface-area-mosteller',
      );
    }
  });
});

describe('body surface area schema matches the hardcoded Mosteller implementation', () => {
  const schema = () => calculatorSchemaFromModules('body-surface-area-mosteller');

  it.each([
    { heightCm: 180, weightKg: 75 },
    { heightCm: 50, weightKg: 3.2 },
    { heightCm: 260, weightKg: 500 },
  ])('%o', ({ heightCm, weightKg }) => {
    const legacy = calculateMostellerBsa({ heightCm, weightKg });
    const schemaResult = evaluateCalculatorSchema(schema(), { heightCm, weightKg });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('value' in legacy)) throw new Error('unreachable');
    expectNumberOutput(schemaResult.outputs[0]);
    expect(schemaResult.outputs[0].value).toBeCloseTo(legacy.value, 10);
    expect(schemaResult.outputs[0].unit).toBe(legacy.unit);
  });
});

describe('adult eGFR CKD-EPI 2021 schema matches the hardcoded implementation', () => {
  const schema = () => calculatorSchemaFromModules('adult-egfr-ckd-epi-2021');

  it.each([
    { ageYears: 42, sex: 'female' as const, creatinine: 0.9, creatinineUnit: 'mg/dl' as const },
    { ageYears: 65, sex: 'male' as const, creatinine: 90, creatinineUnit: 'umol/l' as const },
  ])('%o', ({ ageYears, sex, creatinine, creatinineUnit }) => {
    const legacy = calculateAdultEgfrCkdEpi2021({ ageYears, sex, creatinine, creatinineUnit });
    const schemaResult = evaluateCalculatorSchema(schema(), {
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
  });
});

describe('pediatric eGFR Schwartz 2009 schema matches the hardcoded implementation', () => {
  const schema = () => calculatorSchemaFromModules('pediatric-egfr-schwartz-2009');

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
    const schemaResult = evaluateCalculatorSchema(schema(), {
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
  });
});

describe('pediatric maintenance fluids schema matches the hardcoded implementation', () => {
  const schema = () => calculatorSchemaFromModules('pediatric-maintenance-fluids');

  it.each([{ weightKg: 5 }, { weightKg: 15 }, { weightKg: 35 }])('%o', ({ weightKg }) => {
    const legacy = calculatePediatricMaintenanceFluids({ weightKg });
    const schemaResult = evaluateCalculatorSchema(schema(), { weightKg });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('values' in legacy)) throw new Error('unreachable');
    legacy.values.forEach((expected, index) => {
      expectNumberOutput(schemaResult.outputs[index]);
      expect(schemaResult.outputs[index].value).toBeCloseTo(expected.value, 8);
    });
  });
});

describe('pediatric oral rehydration schema stages inputs and ongoing losses', () => {
  const schema = () => calculatorSchemaFromModules('pediatric-oral-rehydration');

  it('shows the base plan before requiring loss counts, then recalculates them', () => {
    const base = evaluateCalculatorSchema(
      schema(),
      { ageYears: 1.5, weightKg: 10 },
      { maxStep: 0 },
    );
    expect(base.ok).toBe(true);
    const complete = evaluateCalculatorSchema(schema(), {
      ageYears: 1.5,
      weightKg: 10,
      diarrheaEpisodes: 3,
      vomitingEpisodes: 2,
    });
    expect(complete.ok).toBe(true);
    if (!complete.ok) throw new Error('unreachable');
    const ongoing = complete.outputs.find((output) =>
      output.label.includes('Продолжающиеся потери'),
    );
    expectNumberOutput(ongoing);
    expect(ongoing.value).toBe(340);
  });
});
