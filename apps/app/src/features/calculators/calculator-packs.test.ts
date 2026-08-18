import { afterEach, describe, expect, it } from 'vitest';

import {
  calculatorIdsInSection,
  installCalculator,
  installCalculatorSection,
  isCalculatorSectionComplete,
  isCalculatorSectionCore,
  isCalculatorSectionFromDatabase,
  loadCalculatorInstallationState,
  removeCalculatorSection,
  setDatabaseCalculatorIds,
} from '@/features/calculators/calculator-packs';
import {
  CALCULATOR_REGISTRY,
  getCalculatorRegistry,
  registerDownloadedCalculator,
} from '@/features/calculators/calculator-registry';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

function registerCoreClinicalCalculators(): void {
  for (const record of loadToolModuleRecords(['content/tool-modules/core-clinical.json'])) {
    if (record.kind === 'calculator') registerDownloadedCalculator(record);
  }
}

function registerObstetricsCalculators(): void {
  for (const record of loadToolModuleRecords(['content/tool-modules/obstetrics-gynecology.json'])) {
    if (record.kind === 'calculator') registerDownloadedCalculator(record);
  }
}

afterEach(() => setDatabaseCalculatorIds([]));

describe('calculator packs', () => {
  it('installs a complete section and removes its tools together', () => {
    registerCoreClinicalCalculators();
    const registry = getCalculatorRegistry();
    const ids = calculatorIdsInSection('renal', registry);
    const installed = installCalculatorSection('renal', registry);

    expect(ids).toEqual(
      expect.arrayContaining(['adult-egfr-ckd-epi-2021', 'pediatric-egfr-schwartz-2009']),
    );
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(isCalculatorSectionComplete('renal', installed, registry)).toBe(true);
    for (const id of ids) expect(installed.installedIds.has(id)).toBe(true);

    const removed = removeCalculatorSection('renal', registry);
    expect(removed.sectionIds.has('renal')).toBe(false);
    for (const id of ids) expect(removed.installedIds.has(id)).toBe(false);
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
    registerCoreClinicalCalculators();
    const registry = getCalculatorRegistry();
    const ids = calculatorIdsInSection('renal', registry);
    const first = installCalculator(ids[0] ?? '', registry);

    expect(first.sectionIds.has('renal')).toBe(false);
    expect(first.installedIds.has(ids[0] ?? '')).toBe(true);
    expect(first.installedIds.has(ids[1] ?? '')).toBe(false);
    expect(isCalculatorSectionComplete('renal', first, registry)).toBe(false);
  });

  it('installs the gynecology section once its calculators are available', () => {
    registerObstetricsCalculators();
    const registry = getCalculatorRegistry();
    const installed = installCalculatorSection('gynecology', registry);

    expect(installed.sectionIds.has('gynecology')).toBe(true);
    expect(installed.installedIds.has('gynecology-breast-cancer-risk')).toBe(true);
    expect(installed.installedIds.has('gynecology-cervical-cancer-risk')).toBe(true);
  });

  it('treats module-backed calculators as already installed without a download flag', () => {
    registerCoreClinicalCalculators();
    const registry = getCalculatorRegistry();
    const ids = calculatorIdsInSection('renal', registry);
    setDatabaseCalculatorIds(ids);
    const state = loadCalculatorInstallationState(registry);
    expect(ids.every((id) => state.installedIds.has(id))).toBe(true);
    expect(isCalculatorSectionFromDatabase('renal', registry)).toBe(true);
    expect(isCalculatorSectionComplete('renal', state, registry)).toBe(true);
  });
});
