import {
  type CalculatorSchema,
  CalculatorSchemaSchema,
  type CalculatorSearch,
  type ClinicalContextFact,
  type QueryAnalysis,
  type QueryCalculation,
  type QueryClinicalContext,
} from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { resolveCalculatorSuggestion } from '@/features/search/calculator-suggestion';

function schema(
  id = 'paracetamol-dose',
  search: CalculatorSearch = {
    kind: 'medication-dose',
    medication: { canonicalTerm: 'парацетамол', aliases: ['парацетамола'] },
    bindings: {
      ageYearsInputId: 'ageYears',
      weightKgInputId: 'weightKg',
      formInputId: 'form',
      routeInputId: 'route',
    },
  },
): CalculatorSchema {
  const validSchema: CalculatorSchema = CalculatorSchemaSchema.parse({
    schemaVersion: 2,
    id,
    slug: id,
    title: 'Парацетамол',
    shortTitle: 'Парацетамол',
    aliases: [],
    summary: 'Тестовая схема.',
    audience: 'pediatric',
    category: 'medication',
    tags: [],
    clinical: true,
    formulaDisplay: 'Источник',
    population: 'Тестовая популяция.',
    limitations: ['Только для теста.'],
    inputs: [
      { id: 'ageYears', label: 'Возраст', unit: 'лет', kind: 'number', required: false },
      { id: 'weightKg', label: 'Масса', unit: 'кг', kind: 'number', required: false },
      {
        id: 'form',
        label: 'Форма',
        kind: 'select',
        required: false,
        options: [
          { value: 'syrup', label: 'Сироп' },
          { value: 'suspension', label: 'Суспензия' },
          { value: 'tablet', label: 'Таблетки' },
        ],
      },
      {
        id: 'route',
        label: 'Путь',
        kind: 'select',
        required: false,
        options: [
          { value: 'oral', label: 'Перорально' },
          { value: 'intravenous', label: 'Внутривенно' },
        ],
      },
      {
        id: 'indication',
        label: 'Заболевание',
        kind: 'select',
        required: false,
        options: [
          { value: 'asthma', label: 'Бронхиальная астма' },
          { value: 'croup', label: 'Круп' },
        ],
      },
    ],
    steps: [
      {
        id: 'placeholder',
        label: 'Результат',
        unit: 'нет',
        expression: '1',
        isOutput: true,
      },
    ],
    warnings: [],
    interpretations: [],
    evaluation: { status: 'unavailable', rules: [], missingContext: [], sourceIds: [] },
    observationMappings: [],
    assertions: [],
    visuals: [],
    search,
    sources: [
      {
        title: 'Проверенный источник',
        publisher: 'MiniMed test',
        version: '1',
        reviewedAt: '2026-09-03',
      },
    ],
  });
  return validSchema;
}

function fact<Kind extends 'age' | 'weight' | 'dose-form' | 'route'>(
  kind: Kind,
  value: string,
  normalizedValue: string,
  unit: string | null,
): ClinicalContextFact<Kind> {
  return {
    id: `${kind}:0:1`,
    kind,
    label: value,
    value,
    normalizedValue,
    unit,
    polarity: 'positive' as const,
    range: { start: 0, end: value.length },
  } as ClinicalContextFact<Kind>;
}

function context(
  options: {
    age?: ClinicalContextFact<'age'>;
    weight?: ClinicalContextFact<'weight'>;
    doseForm?: ClinicalContextFact<'dose-form'>;
    route?: ClinicalContextFact<'route'>;
  } = {},
): QueryClinicalContext {
  return {
    age: options.age ? [options.age] : [],
    gestationalAge: [],
    sex: [],
    duration: [],
    weight: options.weight ? [options.weight] : [],
    route: options.route ? [options.route] : [],
    doseForm: options.doseForm ? [options.doseForm] : [],
    strength: [],
    frequency: [],
    measurements: [],
    positiveFindings: [],
    negativeFindings: [],
    currentMedicines: [],
    pregnancy: [],
    organFunction: [],
    allergies: [],
  };
}

function analysis(
  calculation?: QueryCalculation,
  clinicalContext?: QueryClinicalContext,
): QueryAnalysis {
  return {
    originalQuery: 'тест',
    normalizedQuery: 'тест',
    facts: [],
    branches: [],
    suggestions: [],
    warnings: [],
    ...(calculation ? { calculation } : {}),
    ...(clinicalContext ? { clinicalContext } : {}),
  } as QueryAnalysis;
}

describe('resolveCalculatorSuggestion', () => {
  it('selects one exact source-backed calculator and preserves option order', () => {
    const result = resolveCalculatorSuggestion(
      analysis(
        {
          kind: 'medication-dose',
          medicationCandidates: [
            { canonicalTerm: 'ПАРАЦЕТАМОЛ', matchedText: 'парацетамол', matchType: 'exact' },
          ],
        },
        context({
          age: fact('age', '6 лет', '6 лет', 'лет'),
          weight: fact('weight', '20 кг', '20 кг', 'кг'),
          doseForm: fact('dose-form', 'сиропом', 'сироп', null),
          route: fact('route', 'перорально', 'перорально', null),
        }),
      ),
      [schema()],
    );

    expect(result).toEqual({
      candidates: [
        {
          calculatorId: 'paracetamol-dose',
          label: 'парацетамол',
          canonicalTerm: 'парацетамол',
          matchedText: 'парацетамол',
          matchType: 'exact',
          draftInputs: { ageYears: 6, weightKg: 20, form: 'syrup', route: 'oral' },
          formOptions: [
            { value: 'syrup', label: 'Сироп' },
            { value: 'suspension', label: 'Суспензия' },
            { value: 'tablet', label: 'Таблетки' },
          ],
          routeOptions: [
            { value: 'oral', label: 'Перорально' },
            { value: 'intravenous', label: 'Внутривенно' },
          ],
          indicationOptions: [],
        },
      ],
      kind: 'medication-dose',
      selectedCalculatorId: 'paracetamol-dose',
      requiresConfirmation: false,
      draftInputs: { ageYears: 6, weightKg: 20, form: 'syrup', route: 'oral' },
      formOptions: [
        { value: 'syrup', label: 'Сироп' },
        { value: 'suspension', label: 'Суспензия' },
        { value: 'tablet', label: 'Таблетки' },
      ],
      routeOptions: [
        { value: 'oral', label: 'Перорально' },
        { value: 'intravenous', label: 'Внутривенно' },
      ],
      indicationOptions: [],
    });
  });

  it('requires confirmation for fuzzy or ambiguous candidates', () => {
    const fuzzy = resolveCalculatorSuggestion(
      analysis({
        kind: 'medication-dose',
        medicationCandidates: [
          { canonicalTerm: 'парацетамол', matchedText: 'парацетамолл', matchType: 'fuzzy' },
        ],
      }),
      [schema()],
    );
    expect(fuzzy?.selectedCalculatorId).toBeUndefined();
    expect(fuzzy?.requiresConfirmation).toBe(true);

    const ambiguous = resolveCalculatorSuggestion(
      analysis(
        {
          kind: 'medication-dose',
          medicationCandidates: [
            { canonicalTerm: 'парацетамол', matchedText: 'парацетамол', matchType: 'exact' },
          ],
        },
        context({
          age: fact('age', '6 лет', '6 лет', 'лет'),
          weight: fact('weight', '20 кг', '20 кг', 'кг'),
          doseForm: fact('dose-form', 'сиропом', 'сироп', null),
          route: fact('route', 'перорально', 'перорально', null),
        }),
      ),
      [schema('dose-one'), schema('dose-two')],
    );
    expect(ambiguous?.selectedCalculatorId).toBeUndefined();
    expect(ambiguous?.requiresConfirmation).toBe(true);
    expect(ambiguous?.candidates.map((candidate) => candidate.calculatorId)).toEqual([
      'dose-one',
      'dose-two',
    ]);
    expect(ambiguous?.candidates.map((candidate) => candidate.draftInputs)).toEqual([
      { ageYears: 6, weightKg: 20, form: 'syrup', route: 'oral' },
      { ageYears: 6, weightKg: 20, form: 'syrup', route: 'oral' },
    ]);
    expect(ambiguous?.candidates.map((candidate) => candidate.formOptions)).toEqual([
      [
        { value: 'syrup', label: 'Сироп' },
        { value: 'suspension', label: 'Суспензия' },
        { value: 'tablet', label: 'Таблетки' },
      ],
      [
        { value: 'syrup', label: 'Сироп' },
        { value: 'suspension', label: 'Суспензия' },
        { value: 'tablet', label: 'Таблетки' },
      ],
    ]);
    expect(ambiguous?.candidates.map((candidate) => candidate.routeOptions)).toEqual([
      [
        { value: 'oral', label: 'Перорально' },
        { value: 'intravenous', label: 'Внутривенно' },
      ],
      [
        { value: 'oral', label: 'Перорально' },
        { value: 'intravenous', label: 'Внутривенно' },
      ],
    ]);
  });

  it('returns undefined when no installed schema matches', () => {
    const result = resolveCalculatorSuggestion(
      analysis({
        kind: 'medication-dose',
        medicationCandidates: [
          { canonicalTerm: 'парацетамол', matchedText: 'парацетамол', matchType: 'exact' },
        ],
      }),
      [
        schema('ibuprofen-dose', {
          kind: 'medication-dose',
          medication: { canonicalTerm: 'ибупрофен', aliases: [] },
          bindings: {},
        }),
      ],
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for an ordinary analysis', () => {
    expect(resolveCalculatorSuggestion(analysis(), [schema()])).toBeUndefined();
  });

  it('does not draft ambiguous age or unsupported form and route values', () => {
    const result = resolveCalculatorSuggestion(
      analysis(
        {
          kind: 'medication-dose',
          medicationCandidates: [
            { canonicalTerm: 'парацетамол', matchedText: 'парацетамол', matchType: 'exact' },
          ],
        },
        context({
          age: fact('age', '24 месяца', '24 месяца', 'месяца'),
          weight: fact('weight', '20 кг', '20 кг', 'кг'),
          doseForm: fact('dose-form', 'капли', 'капли', null),
          route: fact('route', 'подкожно', 'подкожно', null),
        }),
      ),
      [schema()],
    );

    expect(result?.draftInputs).toEqual({ weightKg: 20 });
  });

  it('drafts a uniquely named indication from the original query', () => {
    const result = resolveCalculatorSuggestion(
      {
        ...analysis({
          kind: 'medication-dose',
          medicationCandidates: [
            { canonicalTerm: 'будесонид', matchedText: 'пульмикорт', matchType: 'exact' },
          ],
        }),
        originalQuery: 'Пульмикорт ребенку 12 лет при бронхиальной астме, доза',
      },
      [
        schema('budesonide-dose', {
          kind: 'medication-dose',
          medication: { canonicalTerm: 'будесонид', aliases: ['пульмикорт'] },
          bindings: { indicationInputId: 'indication' },
        }),
      ],
    );

    expect(result?.draftInputs).toEqual({ indication: 'asthma' });
    expect(result?.indicationOptions).toEqual([
      { value: 'asthma', label: 'Бронхиальная астма' },
      { value: 'croup', label: 'Круп' },
    ]);
  });

  it('selects one source-backed infusion calculator and drafts weight', () => {
    const result = resolveCalculatorSuggestion(
      analysis(
        { kind: 'infusion-volume' },
        context({ weight: fact('weight', '80 кг', '80 кг', 'кг') }),
      ),
      [
        schema('infusion-volume', {
          kind: 'infusion-volume',
          bindings: { weightKgInputId: 'weightKg' },
        }),
      ],
    );

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'infusion-volume',
        selectedCalculatorId: 'infusion-volume',
        requiresConfirmation: false,
        draftInputs: { weightKg: 80 },
      }),
    );
    expect(result?.candidates[0]).toEqual(
      expect.objectContaining({
        calculatorId: 'infusion-volume',
        label: 'Парацетамол',
        draftInputs: { weightKg: 80 },
      }),
    );
  });
});
