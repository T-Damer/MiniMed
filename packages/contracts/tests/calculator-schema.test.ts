import { describe, expect, it } from 'vitest';

import { CalculatorSchemaSchema, CalculatorSourceReferenceSchema } from '../src/calculator-schema';

const CALCULATOR_SCHEMA = {
  schemaVersion: 2 as const,
  id: 'medication-dose-test',
  slug: 'medication-dose-test',
  title: 'Тестовый калькулятор',
  shortTitle: 'Тест',
  aliases: [],
  summary: 'Тестовый контракт без клинических правил.',
  audience: 'all' as const,
  category: 'medication' as const,
  clinical: false,
  formulaDisplay: 'Тестовая формула',
  population: 'Тестовая популяция',
  limitations: ['Тестовая схема.'],
  inputs: [
    { id: 'weightKg', label: 'Масса', kind: 'number' as const, required: false },
    { id: 'ageYears', label: 'Возраст', kind: 'number' as const, required: false },
    {
      id: 'form',
      label: 'Форма',
      kind: 'select' as const,
      options: [
        { value: 'liquid', label: 'Жидкая' },
        { value: 'solid', label: 'Твёрдая' },
      ],
      required: false,
    },
    {
      id: 'route',
      label: 'Путь',
      kind: 'select' as const,
      options: [
        { value: 'oral', label: 'Перорально' },
        { value: 'other', label: 'Другой' },
      ],
      required: false,
    },
    {
      id: 'indication',
      label: 'Заболевание',
      kind: 'select' as const,
      options: [
        { value: 'asthma', label: 'Бронхиальная астма' },
        { value: 'croup', label: 'Круп' },
      ],
      required: false,
    },
  ],
  steps: [
    {
      id: 'result',
      label: 'Результат',
      unit: 'единица',
      expression: '1',
      isOutput: true,
    },
  ],
  warnings: [],
  interpretations: [],
  evaluation: { status: 'unavailable' as const, rules: [], missingContext: [], sourceIds: [] },
  observationMappings: [],
  assertions: [],
  visuals: [],
  sources: [
    { title: 'Тестовый источник', publisher: 'Тест', version: '1', reviewedAt: '2026-01-01' },
  ],
};

const SEARCH_METADATA = {
  kind: 'medication-dose' as const,
  medication: { canonicalTerm: 'тестовый препарат' },
  bindings: {
    weightKgInputId: 'weightKg',
    ageYearsInputId: 'ageYears',
    formInputId: 'form',
    routeInputId: 'route',
    indicationInputId: 'indication',
  },
};

describe('calculator source contract', () => {
  it('rejects script and data source URLs', () => {
    const source = {
      title: 'Источник',
      publisher: 'Издатель',
      version: '1',
      reviewedAt: '2026-08-29',
    };
    expect(
      CalculatorSourceReferenceSchema.safeParse({ ...source, url: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      CalculatorSourceReferenceSchema.safeParse({ ...source, url: 'data:text/plain,alert(1)' })
        .success,
    ).toBe(false);
  });

  it('accepts medication search metadata, defaults aliases, and preserves option order', () => {
    const result = CalculatorSchemaSchema.parse({
      ...CALCULATOR_SCHEMA,
      search: SEARCH_METADATA,
    });

    expect(result.search?.medication.aliases).toEqual([]);
    expect(result.search?.bindings.formInputId).toBe('form');
    expect(result.search?.bindings.indicationInputId).toBe('indication');
    expect(
      result.inputs.find((input) => input.id === 'form')?.options?.map((option) => option.value),
    ).toEqual(['liquid', 'solid']);
  });

  it('rejects search bindings that do not reference inputs', () => {
    const result = CalculatorSchemaSchema.safeParse({
      ...CALCULATOR_SCHEMA,
      search: {
        ...SEARCH_METADATA,
        bindings: { weightKgInputId: 'missing' },
      },
    });

    expect(result.success).toBe(false);
  });

  it('accepts infusion-volume discoverability without medication metadata', () => {
    const result = CalculatorSchemaSchema.parse({
      ...CALCULATOR_SCHEMA,
      search: {
        kind: 'infusion-volume',
        bindings: { weightKgInputId: 'weightKg', indicationInputId: 'indication' },
      },
    });

    expect(result.search).toEqual({
      kind: 'infusion-volume',
      bindings: { weightKgInputId: 'weightKg', indicationInputId: 'indication' },
    });
  });

  it('accepts at-least-one input groups and rejects unknown input ids', () => {
    const requirement = {
      kind: 'atLeastOne' as const,
      inputIds: ['weightKg', 'ageYears'],
      message: 'Заполните хотя бы одно поле.',
    };
    expect(
      CalculatorSchemaSchema.parse({ ...CALCULATOR_SCHEMA, inputRequirements: [requirement] })
        .inputRequirements,
    ).toEqual([requirement]);
    expect(
      CalculatorSchemaSchema.safeParse({
        ...CALCULATOR_SCHEMA,
        inputRequirements: [{ ...requirement, inputIds: ['weightKg', 'missing'] }],
      }).success,
    ).toBe(false);
  });

  it.each(['weightKg', 'ageYears'])(
    'requires %s to be a select when bound as a form',
    (inputId) => {
      const result = CalculatorSchemaSchema.safeParse({
        ...CALCULATOR_SCHEMA,
        search: {
          ...SEARCH_METADATA,
          bindings: { formInputId: inputId },
        },
      });

      expect(result.success).toBe(false);
    },
  );

  it.each(['weightKg', 'ageYears'])(
    'requires %s to be a select when bound as a route',
    (inputId) => {
      const result = CalculatorSchemaSchema.safeParse({
        ...CALCULATOR_SCHEMA,
        search: {
          ...SEARCH_METADATA,
          bindings: { routeInputId: inputId },
        },
      });

      expect(result.success).toBe(false);
    },
  );

  it.each(['weightKg', 'ageYears'])(
    'requires %s to be a select when bound as an indication',
    (inputId) => {
      const result = CalculatorSchemaSchema.safeParse({
        ...CALCULATOR_SCHEMA,
        search: {
          ...SEARCH_METADATA,
          bindings: { indicationInputId: inputId },
        },
      });

      expect(result.success).toBe(false);
    },
  );
});
