import { describe, expect, it } from 'vitest';
import {
  calculatorIdsInSection,
  installCalculatorSection,
  isCalculatorSectionComplete,
  removeCalculatorSection,
} from '@/features/calculators/calculator-packs';
import { CALCULATOR_REGISTRY } from '@/features/calculators/calculator-registry';

describe('calculator packs', () => {
  it('installs a complete section and removes its tools together', () => {
    const ids = calculatorIdsInSection('renal', CALCULATOR_REGISTRY);
    const installed = installCalculatorSection('renal', CALCULATOR_REGISTRY);

    expect(ids).toEqual(['adult-egfr-ckd-epi-2021', 'pediatric-egfr-schwartz-2009']);
    expect(isCalculatorSectionComplete('renal', installed, CALCULATOR_REGISTRY)).toBe(true);
    expect([...installed.installedIds]).toEqual(ids);

    const removed = removeCalculatorSection('renal', CALCULATOR_REGISTRY);
    expect(removed.sectionIds.has('renal')).toBe(false);
    expect(removed.installedIds.size).toBe(0);
  });
});
