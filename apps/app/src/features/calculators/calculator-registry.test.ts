import { describe, expect, it } from 'vitest';

import {
  AVAILABLE_CALCULATORS,
  CALCULATOR_REGISTRY,
  findCalculator,
  searchCalculators,
} from '@/features/calculators/calculator-registry';

describe('calculator registry', () => {
  it('keeps calculator identifiers and available slugs unique', () => {
    const ids = CALCULATOR_REGISTRY.map((calculator) => calculator.id);
    const slugs = AVAILABLE_CALCULATORS.map((calculator) => calculator.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('requires sources, population and limitations for available clinical calculators', () => {
    const clinical = AVAILABLE_CALCULATORS.filter((calculator) => calculator.clinical);
    expect(clinical.length).toBeGreaterThanOrEqual(4);
    for (const calculator of clinical) {
      expect(calculator.sources.length).toBeGreaterThan(0);
      expect(calculator.population.trim().length).toBeGreaterThan(20);
      expect(calculator.limitations.length).toBeGreaterThan(0);
      expect(calculator.formula.trim().length).toBeGreaterThan(10);
      for (const source of calculator.sources) {
        expect(source.url).toMatch(/^https:\/\//u);
        expect(source.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      }
    }
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

  it('finds calculators by id or slug and searches aliases', () => {
    expect(findCalculator('unit-conversion')).toMatchObject({ state: 'available' });
    expect(findCalculator('adult-egfr-ckd-epi-2021')).toMatchObject({
      title: expect.stringContaining('CKD-EPI'),
    });
    expect(searchCalculators('шварца')).toHaveLength(1);
    expect(searchCalculators('4-2-1')).toHaveLength(1);
    expect(findCalculator('missing-calculator')).toBeUndefined();
  });
});
