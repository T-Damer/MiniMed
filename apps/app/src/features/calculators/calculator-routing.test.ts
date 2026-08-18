import { beforeAll, describe, expect, it } from 'vitest';

import { registerDownloadedCalculator } from '@/features/calculators/calculator-registry';
import {
  calculatorParentHash,
  calculatorSectionCrumbs,
  calculatorSectionPath,
  calculatorWorkspaceCrumbs,
} from '@/features/calculators/calculator-routing';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

beforeAll(() => {
  const record = loadToolModuleRecords(['content/tool-modules/core-clinical.json']).find(
    (candidate) => candidate.kind === 'calculator' && candidate.slug === 'body-surface-area-mosteller',
  );
  if (record?.kind === 'calculator') registerDownloadedCalculator(record);
});

describe('calculator routing', () => {
  it('builds section hashes and parent hashes', () => {
    expect(calculatorSectionPath('unit-conversion')).toBe('#/calculators/section/unit-conversion');
    expect(calculatorParentHash('calculators/section/unit-conversion')).toBe('#/calculators');
    expect(calculatorParentHash('calculators/body-surface-area-mosteller')).toBe(
      '#/calculators/section/anthropometry',
    );
  });

  it('builds section and workspace breadcrumbs', () => {
    expect(calculatorSectionCrumbs('Преобразование единиц')).toEqual([
      { label: 'Калькуляторы', href: '#/calculators' },
      { label: 'Преобразование единиц' },
    ]);
    expect(
      calculatorWorkspaceCrumbs({
        title: 'Масса, длина и объём',
        sectionId: 'unit-conversion',
        sectionTitle: 'Преобразование единиц',
      }),
    ).toEqual([
      { label: 'Калькуляторы', href: '#/calculators' },
      { label: 'Преобразование единиц', href: calculatorSectionPath('unit-conversion') },
      { label: 'Масса, длина и объём' },
    ]);
  });
});
