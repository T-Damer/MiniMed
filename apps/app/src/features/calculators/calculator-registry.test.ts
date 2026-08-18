import { describe, expect, it } from 'vitest';

import {
  AVAILABLE_CALCULATORS,
  CALCULATOR_REGISTRY,
  findCalculator,
  getCalculatorRegistry,
  registerDownloadedCalculator,
  searchCalculators,
} from '@/features/calculators/calculator-registry';
import type { AvailableCalculatorDefinition } from '@/features/calculators/calculator-types';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

function isAvailableClinicalCalculator(
  calculator: ReturnType<typeof getCalculatorRegistry>[number],
): calculator is AvailableCalculatorDefinition {
  return calculator.state === 'available' && calculator.clinical;
}

describe('calculator registry', () => {
  it('keeps bundled calculator identifiers and slugs unique', () => {
    const ids = CALCULATOR_REGISTRY.map((calculator) => calculator.id);
    const slugs = AVAILABLE_CALCULATORS.map((calculator) => calculator.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(ids).toEqual(['unit-conversion']);
  });

  it('requires sources, population and limitations for downloaded clinical calculators', () => {
    for (const record of loadToolModuleRecords(['content/tool-modules/core-clinical.json'])) {
      if (record.kind !== 'calculator') continue;
      registerDownloadedCalculator(record);
    }
    const clinical = getCalculatorRegistry().filter(isAvailableClinicalCalculator);
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

  it('finds unit-conversion by id and downloaded calculators after registration', () => {
    const record = loadToolModuleRecords(['content/tool-modules/core-clinical.json']).find(
      (candidate) =>
        candidate.kind === 'calculator' && candidate.slug === 'adult-egfr-ckd-epi-2021',
    );
    expect(record).toBeDefined();
    if (record) registerDownloadedCalculator(record);
    expect(findCalculator('unit-conversion')).toMatchObject({ state: 'available' });
    expect(findCalculator('adult-egfr-ckd-epi-2021')).toMatchObject({
      title: expect.stringContaining('CKD-EPI'),
    });
    expect(searchCalculators('шварца')).toHaveLength(1);
    expect(findCalculator('missing-calculator')).toBeUndefined();
  });
});
