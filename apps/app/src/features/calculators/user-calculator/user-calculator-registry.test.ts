import { afterEach, describe, expect, it } from 'vitest';
import {
  CALCULATOR_SECTIONS,
  calculatorsInSection,
  installCalculator,
  installCalculatorSection,
  isCalculatorSectionCore,
  loadCalculatorInstallationState,
  removeCalculatorSection,
} from '@/features/calculators/calculator-packs';
import {
  clearDownloadedCalculators,
  clearUserCalculators,
  findCalculator,
  getCalculatorRegistry,
  registerDownloadedCalculator,
  registerUserCalculators,
  searchCalculators,
} from '@/features/calculators/calculator-registry';
import {
  calculatorParentHash,
  calculatorSectionPath,
  calculatorWorkspaceCrumbs,
} from '@/features/calculators/calculator-routing';
import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';
import { isUserCalculatorId } from '@/features/calculators/user-calculator/user-calculator-ids';
import { matchingCatalogTools, searchCatalogTools } from '@/features/search/searchCatalog';
import { segmentTextWithToolLinks } from '@/features/tool-links/document-tool-links';
import { newUserCalculator, type UserCalculator } from '@/state/user-calculators';

function withoutPopulation(model: UserCalculator): UserCalculator {
  const { population: _removed, ...rest } = model;
  return rest;
}

function calculator(id: string, overrides: Partial<UserCalculator> = {}): UserCalculator {
  return {
    ...newUserCalculator('2026-10-05T10:00:00.000Z'),
    id,
    title: 'Индекс массы тела',
    description: 'Считает ИМТ',
    population: { group: 'children', minAge: { value: 2, unit: 'years' } },
    inputs: [
      {
        id: 'x1',
        name: 'масса',
        label: 'Масса',
        unit: 'кг',
        minimum: 3,
        maximum: 200,
        integer: false,
      },
      {
        id: 'x2',
        name: 'рост',
        label: 'Рост',
        unit: 'см',
        minimum: 40,
        maximum: 220,
        integer: false,
      },
    ],
    result: { label: 'ИМТ', unit: 'кг/м²', decimals: 1 },
    formula: 'масса / (рост / 100) ^ 2',
    bands: [{ id: 'b1', max: 18.4, headline: 'Дефицит', message: '' }],
    ...overrides,
  };
}

const CHILD = 'uc-child0000001';
const ADULT = 'uc-adult0000001';

afterEach(() => {
  clearUserCalculators();
  clearDownloadedCalculators();
});

describe('registering the doctor’s calculators', () => {
  it('puts a finished calculator in the registry and the schema catalog', () => {
    registerUserCalculators([calculator(CHILD)]);
    const definition = findCalculator(CHILD);
    expect(definition).toMatchObject({
      id: `user-calculator:${CHILD}`,
      slug: CHILD,
      state: 'available',
      title: 'Индекс массы тела',
      category: 'custom',
      clinical: false,
      version: '2026-10-05T10:00:00.000Z',
      formula: 'масса / (рост / 100) ^ 2',
      population: 'Дети от 2 лет. Указано автором калькулятора.',
      limitations: ['Авторский калькулятор. Результат не заменяет клиническую оценку.'],
      inputs: [
        { input: 'x1', unit: 'кг', minimum: 3, maximum: 200, required: true },
        { input: 'x2', unit: 'см', minimum: 40, maximum: 220, required: true },
      ],
    });
    // The route slug and the registered id both find it.
    expect(findCalculator(`user-calculator:${CHILD}`)).toBe(definition);
    expect(getCalculatorRegistry()).toContain(definition);
    expect(getCalculatorSchema(`user-calculator:${CHILD}`)).toMatchObject({
      category: 'custom',
      slug: CHILD,
    });
    expect(isUserCalculatorId(`user-calculator:${CHILD}`)).toBe(true);
    expect(isUserCalculatorId('unit-conversion')).toBe(false);
  });

  it('registers only calculators that can run', () => {
    registerUserCalculators([
      withoutPopulation(calculator(CHILD)),
      calculator(ADULT, { formula: 'вес' }),
    ]);
    expect(findCalculator(CHILD)).toBeUndefined();
    expect(findCalculator(ADULT)).toBeUndefined();
    expect(getCalculatorSchema(`user-calculator:${CHILD}`)).toBeUndefined();
  });

  it('replaces what was registered before and removes a calculator that is gone or broken', () => {
    registerUserCalculators([calculator(CHILD), calculator(ADULT)]);
    expect(findCalculator(CHILD)).toBeDefined();
    expect(findCalculator(ADULT)).toBeDefined();

    registerUserCalculators([calculator(CHILD, { title: 'Новое название' })]);
    expect(findCalculator(CHILD)).toMatchObject({ title: 'Новое название' });
    expect(findCalculator(ADULT)).toBeUndefined();
    expect(getCalculatorSchema(`user-calculator:${ADULT}`)).toBeUndefined();

    registerUserCalculators([calculator(CHILD, { formula: '' })]);
    expect(findCalculator(CHILD)).toBeUndefined();

    registerUserCalculators([calculator(CHILD)]);
    clearUserCalculators();
    expect(findCalculator(CHILD)).toBeUndefined();
    expect(getCalculatorSchema(`user-calculator:${CHILD}`)).toBeUndefined();
  });

  it('survives the refresh that clears downloaded calculators', () => {
    registerUserCalculators([calculator(CHILD)]);
    const record = loadToolModuleRecords(['content/tool-modules/core-clinical.json']).find(
      (candidate) => candidate.kind === 'calculator',
    );
    if (record?.kind !== 'calculator') throw new Error('Missing downloaded calculator fixture.');
    registerDownloadedCalculator(record);
    expect(getCalculatorSchema(record.id)).toBeDefined();

    clearDownloadedCalculators();
    expect(getCalculatorSchema(record.id)).toBeUndefined();
    expect(findCalculator(CHILD)).toBeDefined();
    expect(getCalculatorSchema(`user-calculator:${CHILD}`)).toBeDefined();
  });

  it('is found by search', () => {
    registerUserCalculators([calculator(CHILD)]);
    expect(searchCalculators('индекс массы').map((entry) => entry.id)).toContain(
      `user-calculator:${CHILD}`,
    );
    expect(searchCalculators('дети').map((entry) => entry.id)).toContain(
      `user-calculator:${CHILD}`,
    );
  });

  it('is never turned into a link inside a source document', () => {
    registerUserCalculators([calculator(CHILD)]);
    expect(
      segmentTextWithToolLinks('Индекс массы тела рассчитывают по формуле.').some(
        (segment) => segment.kind === 'calculator',
      ),
    ).toBe(false);
  });
});

describe('installed without a download', () => {
  it('counts as installed and its section as always available', () => {
    registerUserCalculators([calculator(CHILD)]);
    const registry = getCalculatorRegistry();
    const state = loadCalculatorInstallationState(registry);
    expect(state.installedIds.has(`user-calculator:${CHILD}`)).toBe(true);
    expect(isCalculatorSectionCore('custom', registry)).toBe(true);
    expect(calculatorsInSection('custom', registry).map((entry) => entry.id)).toEqual([
      `user-calculator:${CHILD}`,
    ]);
  });

  it('is not touched by installing or removing sections, or by a per-calculator install', () => {
    registerUserCalculators([calculator(CHILD)]);
    const registry = getCalculatorRegistry();
    const id = `user-calculator:${CHILD}`;
    for (const next of [
      installCalculatorSection('custom', registry),
      installCalculator(id, registry),
      removeCalculatorSection('custom', registry),
      removeCalculatorSection('renal', registry),
    ]) {
      expect(next.installedIds.has(id)).toBe(true);
      expect(next.sectionIds.has('custom')).toBe(false);
      expect(next.calculatorIds.has(id)).toBe(false);
    }
  });

  it('has a section entry of its own named «Мои калькуляторы»', () => {
    expect(CALCULATOR_SECTIONS.find((section) => section.id === 'custom')).toMatchObject({
      title: 'Мои калькуляторы',
    });
  });
});

describe('lists and the age filter', () => {
  it('lists a calculator in the search catalog with its age badge scope', () => {
    registerUserCalculators([calculator(CHILD)]);
    const row = searchCatalogTools().find((entry) => entry.id === `user-calculator:${CHILD}`);
    expect(row).toMatchObject({
      scope: 'calculators',
      group: 'custom',
      title: 'Индекс массы тела',
      href: `#/calculators/${CHILD}`,
      ageScope: { groups: ['children'], minAge: { value: 2, unit: 'years' } },
    });
    expect(row?.createsNew).toBeUndefined();
  });

  it('hides a children calculator behind «Взрослые» and shows an adult one', () => {
    registerUserCalculators([
      calculator(CHILD),
      calculator(ADULT, { title: 'Взрослый ИМТ', population: { group: 'adults' } }),
    ]);
    const rows = searchCatalogTools();
    const titles = (filter: 'children' | 'adults' | 'all'): string[] =>
      matchingCatalogTools(rows, 'calculators', 'custom', '', filter).map((entry) => entry.title);
    expect(titles('adults')).toContain('Взрослый ИМТ');
    expect(titles('adults')).not.toContain('Индекс массы тела');
    expect(titles('children')).toContain('Индекс массы тела');
    expect(titles('children')).not.toContain('Взрослый ИМТ');
    expect(titles('all')).toEqual(expect.arrayContaining(['Индекс массы тела', 'Взрослый ИМТ']));
  });
});

describe('routing', () => {
  it('opens on the ordinary calculator route and goes back to the list', () => {
    registerUserCalculators([calculator(CHILD)]);
    const id = `user-calculator:${CHILD}`;
    expect(findCalculator(CHILD)?.id).toBe(id);
    expect(calculatorParentHash(`calculators/${CHILD}`)).toBe('#/calculators/mine');
    expect(calculatorSectionPath('custom')).toBe('#/calculators/mine');
    expect(
      calculatorWorkspaceCrumbs({
        title: 'ИМТ',
        sectionId: 'custom',
        sectionTitle: 'Мои калькуляторы',
      }),
    ).toEqual([
      { label: 'Калькуляторы', href: '#/calculators' },
      { label: 'Мои калькуляторы', href: '#/calculators/mine' },
      { label: 'ИМТ' },
    ]);
  });

  it('goes up from the list, the new draft and the editor', () => {
    expect(calculatorParentHash('calculators/mine')).toBe('#/calculators');
    expect(calculatorParentHash('calculators/section/custom')).toBe('#/calculators');
    expect(calculatorParentHash('calculators/mine/new')).toBe('#/calculators/mine');
    expect(calculatorParentHash(`calculators/mine/${CHILD}/edit`)).toBe('#/calculators/mine');
    // A calculator that no longer exists falls back to the home list instead of a dead section.
    expect(calculatorParentHash('calculators/uc-gone0000000')).toBe('#/calculators');
  });
});
