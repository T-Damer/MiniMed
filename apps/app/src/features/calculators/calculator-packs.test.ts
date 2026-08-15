import { describe, expect, it } from 'vitest';
import {
  calculatorIdsInSection,
  installCalculator,
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

  it('installs one calculator without installing the whole section', () => {
    const ids = calculatorIdsInSection('renal', CALCULATOR_REGISTRY);
    const first = installCalculator(ids[0] ?? '', CALCULATOR_REGISTRY);

    expect(first.sectionIds.has('renal')).toBe(false);
    expect(first.installedIds.has(ids[0] ?? '')).toBe(true);
    expect(first.installedIds.has(ids[1] ?? '')).toBe(false);
    expect(isCalculatorSectionComplete('renal', first, CALCULATOR_REGISTRY)).toBe(false);
  });

  it('does not install a section that has no available calculators', () => {
    const installed = installCalculatorSection('gynecology', CALCULATOR_REGISTRY);

    expect(installed.sectionIds.has('gynecology')).toBe(false);
  });
});
