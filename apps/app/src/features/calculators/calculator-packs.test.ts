import { describe, expect, it } from 'vitest';
import {
  calculatorIdsInSection,
  installCalculatorSection,
  isCalculatorSectionComplete,
  isCalculatorSectionCore,
  loadCalculatorInstallationState,
  removeCalculatorSection,
} from '@/features/calculators/calculator-packs';
import { CALCULATOR_REGISTRY } from '@/features/calculators/calculator-registry';

describe('calculator packs', () => {
  it('installs a complete section and removes its tools together', () => {
    const ids = calculatorIdsInSection('renal', CALCULATOR_REGISTRY);
    const installed = installCalculatorSection('renal', CALCULATOR_REGISTRY);

    expect(ids).toEqual(['adult-egfr-ckd-epi-2021', 'pediatric-egfr-schwartz-2009']);
    expect(isCalculatorSectionComplete('renal', installed, CALCULATOR_REGISTRY)).toBe(true);
    for (const id of ids) expect(installed.installedIds.has(id)).toBe(true);

    const removed = removeCalculatorSection('renal', CALCULATOR_REGISTRY);
    expect(removed.sectionIds.has('renal')).toBe(false);
    for (const id of ids) expect(removed.installedIds.has(id)).toBe(false);
    // unit-conversion is a CORE calculator: it stays installed without an explicit section download.
    expect(removed.installedIds.has('unit-conversion')).toBe(true);
  });

  it('treats unit-conversion as a CORE section available without installing', () => {
    const state = loadCalculatorInstallationState(CALCULATOR_REGISTRY);
    expect(state.sectionIds.has('unit-conversion')).toBe(false);
    expect(state.installedIds.has('unit-conversion')).toBe(true);
    expect(isCalculatorSectionCore('unit-conversion', CALCULATOR_REGISTRY)).toBe(true);
    expect(isCalculatorSectionComplete('unit-conversion', state, CALCULATOR_REGISTRY)).toBe(true);
    expect(isCalculatorSectionCore('renal', CALCULATOR_REGISTRY)).toBe(false);
  });
});
