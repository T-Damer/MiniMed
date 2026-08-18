import { describe, expect, it } from 'vitest';

import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import { calculatorSchemaFromModules } from '@/features/calculators/tool-module-test-helpers';

const ADULT_EGFR_CKD_EPI_2021_SCHEMA = calculatorSchemaFromModules('adult-egfr-ckd-epi-2021');

describe('validateCalculatorSchema', () => {
  it('accepts the migrated CKD-EPI schema', () => {
    const result = validateCalculatorSchema(ADULT_EGFR_CKD_EPI_2021_SCHEMA);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a schema failing basic shape validation', () => {
    const result = validateCalculatorSchema({ schemaVersion: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a step expression referencing an unknown variable', () => {
    const candidate = {
      ...ADULT_EGFR_CKD_EPI_2021_SCHEMA,
      steps: [
        {
          id: 'broken',
          label: 'Broken step',
          unit: 'x',
          expression: 'undeclaredVariable * 2',
          displayPrecision: 2,
          isOutput: true,
        },
      ],
    };
    const result = validateCalculatorSchema(candidate);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('undeclaredVariable'))).toBe(true);
  });

  it('rejects a step referencing a later step (no forward references)', () => {
    const candidate = {
      ...ADULT_EGFR_CKD_EPI_2021_SCHEMA,
      steps: [
        {
          id: 'a',
          label: 'A',
          unit: 'x',
          expression: 'b + 1',
          displayPrecision: 2,
          isOutput: false,
        },
        {
          id: 'b',
          label: 'B',
          unit: 'x',
          expression: 'ageYears',
          displayPrecision: 2,
          isOutput: true,
        },
      ],
    };
    const result = validateCalculatorSchema(candidate);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('"b"'))).toBe(true);
  });

  it('rejects malformed expression syntax with a clear per-step error', () => {
    const candidate = {
      ...ADULT_EGFR_CKD_EPI_2021_SCHEMA,
      steps: [
        {
          id: 'broken',
          label: 'Broken',
          unit: 'x',
          expression: '2 +',
          displayPrecision: 2,
          isOutput: true,
        },
      ],
    };
    const result = validateCalculatorSchema(candidate);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith('step "broken":'))).toBe(true);
  });

  it('maps pack-specific calculator categories onto catalog sections', () => {
    const neonatology = validateCalculatorSchema({
      ...ADULT_EGFR_CKD_EPI_2021_SCHEMA,
      category: 'neonatology',
    });
    expect(neonatology.ok).toBe(true);
    expect(neonatology.schema?.category).toBe('neonatology');

    const aliased = validateCalculatorSchema({
      ...ADULT_EGFR_CKD_EPI_2021_SCHEMA,
      category: 'pediatric-gastroenterology',
    });
    expect(aliased.ok).toBe(true);
    expect(aliased.schema?.category).toBe('gastroenterology');
  });
});
