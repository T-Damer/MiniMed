import { describe, expect, it } from 'vitest';

import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import { calculatorSchemaFromModules } from '@/features/calculators/tool-module-test-helpers';
import { UNIT_CONVERSION_SCHEMA } from '@/features/calculators/unit-conversion-schema';

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

  it('rejects an input dependency that does not point to an earlier input', () => {
    const candidate = {
      ...ADULT_EGFR_CKD_EPI_2021_SCHEMA,
      inputs: ADULT_EGFR_CKD_EPI_2021_SCHEMA.inputs.map((input, index) =>
        index === 0 ? { ...input, requiresInput: 'missing_input' } : input,
      ),
    };
    const result = validateCalculatorSchema(candidate);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('missing_input'))).toBe(true);
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

  describe('grouped selects and units taken from a select', () => {
    const withInput = (index: number, change: Record<string, unknown>) => ({
      ...UNIT_CONVERSION_SCHEMA,
      inputs: UNIT_CONVERSION_SCHEMA.inputs.map((input, position) =>
        position === index ? { ...input, ...change } : input,
      ),
    });

    it('accepts the built-in converter', () => {
      expect(validateCalculatorSchema(UNIT_CONVERSION_SCHEMA).errors).toEqual([]);
    });

    it('rejects a select grouped by a later or unknown input', () => {
      const result = validateCalculatorSchema(withInput(0, { optionGroupInput: 'targetUnit' }));
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('grouped by unknown, later or non-select input');
      expect(validateCalculatorSchema(withInput(2, { optionGroupInput: 'nobody' })).ok).toBe(false);
    });

    it('rejects a select grouped by a number input', () => {
      expect(validateCalculatorSchema(withInput(2, { optionGroupInput: 'amount' })).ok).toBe(false);
    });

    it('rejects a grouped option without a group', () => {
      const result = validateCalculatorSchema(
        withInput(2, { options: [{ value: 1, label: 'кг' }] }),
      );
      expect(result.errors.join(' ')).toContain('every option needs a group');
    });

    it('rejects a unit taken from an input that is not a select', () => {
      const result = validateCalculatorSchema({
        ...UNIT_CONVERSION_SCHEMA,
        steps: UNIT_CONVERSION_SCHEMA.steps.map((step) => ({ ...step, unitFromInput: 'amount' })),
      });
      expect(result.errors.join(' ')).toContain('unit comes from unknown or non-select input');
    });
  });
});
