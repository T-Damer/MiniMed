import { describe, expect, it } from 'vitest';

import {
  CALCULATOR_REGISTRY,
  findCalculator,
} from '@/features/calculators/calculator-registry';

describe('calculator registry', () => {
  it('keeps calculator identifiers unique', () => {
    const ids = CALCULATOR_REGISTRY.map((calculator) => calculator.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes only the non-clinical converter before clinical sources are locked', () => {
    const available = CALCULATOR_REGISTRY.filter((calculator) => calculator.state === 'available');

    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({ id: 'unit-conversion', clinical: false });
  });

  it('requires a source gate for every planned clinical calculator', () => {
    const plannedClinical = CALCULATOR_REGISTRY.filter(
      (calculator) => calculator.state === 'planned' && calculator.clinical,
    );

    expect(plannedClinical.length).toBeGreaterThan(0);
    for (const calculator of plannedClinical) {
      expect(calculator.sourceRequirement.trim().length).toBeGreaterThan(20);
    }
  });

  it('finds known calculators and returns undefined for unknown identifiers', () => {
    expect(findCalculator('unit-conversion')).toMatchObject({ state: 'available' });
    expect(findCalculator('missing-calculator')).toBeUndefined();
  });
});
