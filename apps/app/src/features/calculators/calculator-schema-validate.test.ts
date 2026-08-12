import { describe, expect, it } from 'vitest';

import { ADULT_EGFR_CKD_EPI_2021_SCHEMA } from '@/features/calculators/calculator-schema-catalog';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';

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
});
