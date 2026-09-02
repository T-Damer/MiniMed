import type { QueryFactPolarity } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { analyzeClinicalQuery, buildLexicalQueryPlan } from '../src/index';

interface ContextCase {
  readonly name: string;
  readonly query: string;
  readonly field:
    | 'age'
    | 'gestationalAge'
    | 'sex'
    | 'duration'
    | 'weight'
    | 'route'
    | 'doseForm'
    | 'strength'
    | 'frequency'
    | 'measurements'
    | 'positiveFindings'
    | 'negativeFindings'
    | 'currentMedicines'
    | 'pregnancy'
    | 'organFunction'
    | 'allergies';
  readonly raw: string;
  readonly normalizedValue: string;
  readonly unit: string | null;
  readonly polarity?: QueryFactPolarity;
}

const CONTEXT_CASES: readonly ContextCase[] = [
  {
    name: 'reuses age',
    query: 'ребёнку 12 лет',
    field: 'age',
    raw: 'ребёнку 12 лет',
    normalizedValue: '12 лет',
    unit: 'лет',
  },
  {
    name: 'recognizes an inflected year age',
    query: 'назначить 12-летнему',
    field: 'age',
    raw: '12-летнему',
    normalizedValue: '12 лет',
    unit: 'лет',
  },
  {
    name: 'recognizes an adolescent age phrase',
    query: 'подросток 12 лет',
    field: 'age',
    raw: 'подросток 12 лет',
    normalizedValue: '12 лет',
    unit: 'лет',
  },
  {
    name: 'converts compound age to months',
    query: 'ребёнку 1 год 3 месяца',
    field: 'age',
    raw: '1 год 3 месяца',
    normalizedValue: '15 месяцев',
    unit: 'месяцев',
  },
  {
    name: 'converts half-year age to months',
    query: 'ребёнку полтора года',
    field: 'age',
    raw: 'полтора года',
    normalizedValue: '18 месяцев',
    unit: 'месяцев',
  },
  {
    name: 'expands abbreviated months',
    query: 'ребёнку 6 мес',
    field: 'age',
    raw: '6 мес',
    normalizedValue: '6 месяцев',
    unit: 'месяцев',
  },
  {
    name: 'recognizes neonatal stage without inventing an age',
    query: 'новорождённый',
    field: 'age',
    raw: 'новорождённый',
    normalizedValue: 'неонатальный период',
    unit: null,
  },
  {
    name: 'normalizes kilograms',
    query: 'вес 30кг',
    field: 'weight',
    raw: 'вес 30кг',
    normalizedValue: '30 кг',
    unit: 'кг',
  },
  {
    name: 'normalizes decimal kilograms',
    query: 'весом 8,5 кг',
    field: 'weight',
    raw: 'весом 8,5 кг',
    normalizedValue: '8.5 кг',
    unit: 'кг',
  },
  {
    name: 'converts grams to kilograms',
    query: 'масса 3200 г',
    field: 'weight',
    raw: 'масса 3200 г',
    normalizedValue: '3.2 кг',
    unit: 'кг',
  },
  {
    name: 'parses a number word weight',
    query: 'примерно двадцать килограмм',
    field: 'weight',
    raw: 'примерно двадцать килограмм',
    normalizedValue: '20 кг',
    unit: 'кг',
  },
  {
    name: 'recognizes blood pressure written with на',
    query: 'АД 200 на 120',
    field: 'measurements',
    raw: 'АД 200 на 120',
    normalizedValue: '200/120',
    unit: 'мм рт. ст.',
  },
  {
    name: 'recognizes an unlabeled blood pressure pair',
    query: '200/120',
    field: 'measurements',
    raw: '200/120',
    normalizedValue: '200/120',
    unit: 'мм рт. ст.',
  },
  {
    name: 'recognizes intramuscular route abbreviation',
    query: 'цефтриаксон в/м',
    field: 'route',
    raw: 'в/м',
    normalizedValue: 'внутримышечно',
    unit: null,
  },
  {
    name: 'recognizes intravenous route wording',
    query: 'цефтриаксон в вену',
    field: 'route',
    raw: 'в вену',
    normalizedValue: 'внутривенно',
    unit: null,
  },
  {
    name: 'recognizes per os route',
    query: 'принимать per os',
    field: 'route',
    raw: 'per os',
    normalizedValue: 'перорально',
    unit: null,
  },
  {
    name: 'recognizes sublingual route',
    query: 'таблетку под язык',
    field: 'route',
    raw: 'под язык',
    normalizedValue: 'сублингвально',
    unit: null,
  },
  {
    name: 'recognizes nasal route',
    query: 'капли в обе ноздри',
    field: 'route',
    raw: 'в обе ноздри',
    normalizedValue: 'интраназально',
    unit: null,
  },
  {
    name: 'recognizes inhaled route',
    query: 'применять ингаляционно',
    field: 'route',
    raw: 'ингаляционно',
    normalizedValue: 'ингаляционно',
    unit: null,
  },
  {
    name: 'recognizes rectal route',
    query: 'применять ректально',
    field: 'route',
    raw: 'ректально',
    normalizedValue: 'ректально',
    unit: null,
  },
  {
    name: 'recognizes topical route',
    query: 'наносить местно',
    field: 'route',
    raw: 'местно',
    normalizedValue: 'местно',
    unit: null,
  },
  {
    name: 'recognizes a suspension form',
    query: 'лекарственная форма: суспензия',
    field: 'doseForm',
    raw: 'суспензия',
    normalizedValue: 'суспензия',
    unit: null,
  },
  {
    name: 'recognizes a syrup form',
    query: 'лекарственная форма: сироп',
    field: 'doseForm',
    raw: 'сироп',
    normalizedValue: 'сироп',
    unit: null,
  },
  {
    name: 'normalizes the common спироп typo as syrup',
    query: 'лекарственная форма: спиропом',
    field: 'doseForm',
    raw: 'спиропом',
    normalizedValue: 'сироп',
    unit: null,
  },
  {
    name: 'recognizes a tablet form',
    query: 'лекарственная форма: таблетки',
    field: 'doseForm',
    raw: 'таблетки',
    normalizedValue: 'таблетки',
    unit: null,
  },
  {
    name: 'recognizes an ointment form',
    query: 'лекарственная форма: мазь',
    field: 'doseForm',
    raw: 'мазь',
    normalizedValue: 'мазь',
    unit: null,
  },
  {
    name: 'recognizes drops',
    query: 'лекарственная форма: капли',
    field: 'doseForm',
    raw: 'капли',
    normalizedValue: 'капли',
    unit: null,
  },
  {
    name: 'normalizes a concentration slash',
    query: 'ибупрофен 100 мг/5 мл',
    field: 'strength',
    raw: '100 мг/5 мл',
    normalizedValue: '100 мг/5 мл',
    unit: 'мг/5 мл',
  },
  {
    name: 'normalizes a concentration with в',
    query: 'ибупрофен 250 мг в 5 мл',
    field: 'strength',
    raw: '250 мг в 5 мл',
    normalizedValue: '250 мг/5 мл',
    unit: 'мг/5 мл',
  },
  {
    name: 'recognizes a percentage strength',
    query: 'раствор 0,01%',
    field: 'strength',
    raw: '0,01%',
    normalizedValue: '0.01%',
    unit: '%',
  },
  {
    name: 'recognizes vial strength',
    query: 'цефтриаксон 1 г во флаконе',
    field: 'strength',
    raw: '1 г во флаконе',
    normalizedValue: '1 г',
    unit: 'г',
  },
  {
    name: 'recognizes strength per dose',
    query: 'сальбутамол 100 мкг/доза',
    field: 'strength',
    raw: '100 мкг/доза',
    normalizedValue: '100 мкг/доза',
    unit: 'мкг/доза',
  },
  {
    name: 'recognizes numeric daily frequency',
    query: 'принимать 2 раза в день',
    field: 'frequency',
    raw: '2 раза в день',
    normalizedValue: '2 раза в сутки',
    unit: 'раз/сут',
  },
  {
    name: 'recognizes every-eight-hours frequency',
    query: 'принимать каждые 8 часов',
    field: 'frequency',
    raw: 'каждые 8 часов',
    normalizedValue: 'каждые 8 часов',
    unit: 'ч',
  },
  {
    name: 'recognizes a meal-style frequency',
    query: 'принимать утром и вечером',
    field: 'frequency',
    raw: 'утром и вечером',
    normalizedValue: 'утром и вечером',
    unit: null,
  },
  {
    name: 'recognizes a schedule frequency',
    query: 'схема 1-0-1',
    field: 'frequency',
    raw: '1-0-1',
    normalizedValue: '1-0-1',
    unit: null,
  },
  {
    name: 'recognizes one-time frequency',
    query: 'принять однократно',
    field: 'frequency',
    raw: 'однократно',
    normalizedValue: 'однократно',
    unit: null,
  },
  {
    name: 'recognizes bedtime frequency',
    query: 'применять на ночь',
    field: 'frequency',
    raw: 'на ночь',
    normalizedValue: 'на ночь',
    unit: null,
  },
  {
    name: 'recognizes as-needed frequency',
    query: 'принимать по необходимости',
    field: 'frequency',
    raw: 'по необходимости',
    normalizedValue: 'по необходимости',
    unit: null,
  },
  {
    name: 'recognizes a duration range in суток',
    query: 'курс 5–7 суток',
    field: 'duration',
    raw: '5–7 суток',
    normalizedValue: '5-7 суток',
    unit: 'суток',
  },
  {
    name: 'recognizes a before-meal timing',
    query: 'принимать до еды',
    field: 'duration',
    raw: 'до еды',
    normalizedValue: 'до еды',
    unit: null,
  },
  {
    name: 'recognizes an after-meal timing',
    query: 'принимать после еды',
    field: 'duration',
    raw: 'после еды',
    normalizedValue: 'после еды',
    unit: null,
  },
  {
    name: 'recognizes a since-birth timing',
    query: 'наблюдается с рождения',
    field: 'duration',
    raw: 'с рождения',
    normalizedValue: 'с рождения',
    unit: null,
  },
  {
    name: 'recognizes gestational age',
    query: '34 недели гестации',
    field: 'gestationalAge',
    raw: '34 недели гестации',
    normalizedValue: '34 недели',
    unit: 'недели',
  },
  {
    name: 'recognizes gestational age inside pregnancy state',
    query: 'беременность 20 недель',
    field: 'gestationalAge',
    raw: '20 недель',
    normalizedValue: '20 недель',
    unit: 'недель',
  },
  {
    name: 'recognizes positive pregnancy',
    query: 'беременность 20 недель',
    field: 'pregnancy',
    raw: 'беременность 20 недель',
    normalizedValue: 'беременность',
    unit: null,
  },
  {
    name: 'recognizes negative pregnancy',
    query: 'не беременна',
    field: 'pregnancy',
    raw: 'не беременна',
    normalizedValue: 'беременность',
    unit: null,
    polarity: 'negative',
  },
  {
    name: 'recognizes renal insufficiency',
    query: 'почечная недостаточность',
    field: 'organFunction',
    raw: 'почечная недостаточность',
    normalizedValue: 'почечная недостаточность',
    unit: null,
  },
  {
    name: 'recognizes absent renal insufficiency after без',
    query: 'без почечной недостаточности',
    field: 'organFunction',
    raw: 'без почечной недостаточности',
    normalizedValue: 'почечная недостаточность',
    unit: null,
    polarity: 'negative',
  },
  {
    name: 'recognizes absent renal insufficiency before нет',
    query: 'почечной недостаточности нет',
    field: 'organFunction',
    raw: 'почечной недостаточности нет',
    normalizedValue: 'почечная недостаточность',
    unit: null,
    polarity: 'negative',
  },
  {
    name: 'recognizes hepatic insufficiency',
    query: 'печёночная недостаточность',
    field: 'organFunction',
    raw: 'печёночная недостаточность',
    normalizedValue: 'печеночная недостаточность',
    unit: null,
  },
  {
    name: 'recognizes positive allergy with an allergen',
    query: 'аллергия на пенициллин',
    field: 'allergies',
    raw: 'аллергия на пенициллин',
    normalizedValue: 'аллергия на пенициллин',
    unit: null,
  },
  {
    name: 'recognizes absent allergy',
    query: 'аллергии нет',
    field: 'allergies',
    raw: 'аллергии нет',
    normalizedValue: 'аллергия',
    unit: null,
    polarity: 'negative',
  },
  {
    name: 'recognizes a medication not previously taken',
    query: 'антибиотики не принимал',
    field: 'negativeFindings',
    raw: 'антибиотики',
    normalizedValue: 'антибиотики',
    unit: null,
    polarity: 'negative',
  },
];

function contextFor(query: string) {
  const context = analyzeClinicalQuery(query, []).analysis.clinicalContext;
  expect(context).toBeDefined();
  return context as NonNullable<typeof context>;
}

function factFor(
  context: NonNullable<ReturnType<typeof contextFor>>,
  field: ContextCase['field'],
  raw: string,
) {
  const fact = context[field].find((candidate) => candidate.value === raw);
  expect(fact).toBeDefined();
  return fact as NonNullable<typeof fact>;
}

describe('typed dose-critical query context', () => {
  it.each(CONTEXT_CASES)('extracts $name', (testCase) => {
    const context = contextFor(testCase.query);
    const fact = factFor(context, testCase.field, testCase.raw);
    const start = testCase.query.indexOf(testCase.raw);

    expect(fact).toMatchObject({
      value: testCase.raw,
      normalizedValue: testCase.normalizedValue,
      unit: testCase.unit,
      polarity: testCase.polarity ?? 'positive',
      range: { start, end: start + testCase.raw.length },
    });
  });

  it('keeps inflected sex terms and temperature ranges exact', () => {
    const query = 'мальчику 5 лет, температура 39,2° ; пациентка';
    const plan = analyzeClinicalQuery(query, []);
    const context = plan.analysis.clinicalContext;
    expect(context).toBeDefined();
    if (!context) return;

    expect(context.sex).toEqual([
      expect.objectContaining({
        value: 'мальчику',
        normalizedValue: 'мужской',
        range: { start: 0, end: 'мальчику'.length },
      }),
    ]);
    const temperature = factFor(context, 'positiveFindings', 'температура 39,2°');
    const temperatureStart = query.indexOf('температура 39,2°');
    expect(temperature.range).toEqual({
      start: temperatureStart,
      end: temperatureStart + 'температура 39,2°'.length,
    });
    expect(
      analyzeClinicalQuery('пациентка', []).analysis.facts.find((fact) => fact.kind === 'sex'),
    ).toMatchObject({ value: 'пациентка', normalizedValue: 'женский' });
  });

  it('does not include whitespace after a temperature without a degree marker', () => {
    const query = 'температура 39,2 ; кашель';
    const temperature = analyzeClinicalQuery(query, []).analysis.facts.find(
      (fact) => fact.kind === 'temperature' && fact.value === 'температура 39,2',
    );

    expect(temperature).toMatchObject({
      value: 'температура 39,2',
      normalizedValue: '39.2',
      range: { start: 0, end: 'температура 39,2'.length },
    });
    expect(query.slice(temperature?.range.start, temperature?.range.end)).toBe(temperature?.value);
  });

  it('stops allergy and negation facts at spaced punctuation', () => {
    const query =
      'аллергия на пенициллин — почечная недостаточность / антибиотики не принимал ; лечение';
    const context = contextFor(query);

    expect(factFor(context, 'allergies', 'аллергия на пенициллин').normalizedValue).toBe(
      'аллергия на пенициллин',
    );
    expect(factFor(context, 'negativeFindings', 'антибиотики').polarity).toBe('negative');
  });

  it('reuses legacy age and measurement facts in the typed context', () => {
    const query = 'ребёнку 12 лет, АД 200/120';
    const plan = analyzeClinicalQuery(query, []);
    const context = plan.analysis.clinicalContext;
    expect(context).toBeDefined();
    if (!context) return;

    const age = plan.analysis.facts.find((fact) => fact.kind === 'age');
    const pressure = plan.analysis.facts.find(
      (fact) => fact.kind === 'measurement' && fact.label === 'АД',
    );
    expect(context.age).toContainEqual(age);
    expect(context.measurements).toContainEqual(pressure);
  });

  it.each([
    {
      query: '34 недели гестации',
      raw: '34 недели гестации',
      normalizedValue: '34 недели',
      unit: 'недели',
    },
    {
      query: 'беременность 20 недель',
      raw: '20 недель',
      normalizedValue: '20 недель',
      unit: 'недель',
    },
  ])('does not classify $query as illness duration', (testCase) => {
    const plan = analyzeClinicalQuery(testCase.query, []);
    const context = plan.analysis.clinicalContext;
    expect(context).toBeDefined();
    if (!context) return;

    expect(plan.analysis.facts.filter((fact) => fact.kind === 'duration')).toHaveLength(0);
    expect(context.duration).toHaveLength(0);
    const fact = factFor(context, 'gestationalAge', testCase.raw);
    const start = testCase.query.indexOf(testCase.raw);
    expect(fact).toMatchObject({
      normalizedValue: testCase.normalizedValue,
      unit: testCase.unit,
      range: { start, end: start + testCase.raw.length },
    });
  });

  it('projects legacy sex, duration, findings, and current medicines', () => {
    const query = 'Мальчик 5 лет, кашляет 3 дня. Кашля нет. Принимает парацетамол';
    const plan = analyzeClinicalQuery(query, []);
    const context = plan.analysis.clinicalContext;
    expect(context).toBeDefined();
    if (!context) return;

    const sex = plan.analysis.facts.find((fact) => fact.kind === 'sex');
    const duration = plan.analysis.facts.find((fact) => fact.kind === 'duration');
    const medicine = plan.analysis.facts.find((fact) => fact.kind === 'medication');
    expect(context.sex).toContain(sex);
    expect(context.duration).toContain(duration);
    expect(context.positiveFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'symptom', normalizedValue: 'кашель' }),
      ]),
    );
    expect(context.negativeFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'negative-finding', polarity: 'negative' }),
      ]),
    );
    expect(context.currentMedicines).toContain(medicine);
  });

  it('limits positive findings to observed symptoms and measurements', () => {
    const query =
      'Мальчик 5 лет, кашляет 3 дня, температура 38,5, АД 120/80. Принимает парацетамол, контакт, ОАК';
    const context = contextFor(query);

    expect(context.positiveFindings).toHaveLength(3);
    expect(context.positiveFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'symptom', normalizedValue: 'кашель' }),
        expect.objectContaining({ kind: 'temperature', normalizedValue: '38.5' }),
        expect.objectContaining({ kind: 'measurement', label: 'АД' }),
      ]),
    );
    expect(
      context.positiveFindings.some((fact) =>
        ['age', 'sex', 'duration', 'medication', 'epidemiology', 'investigation'].includes(
          fact.kind,
        ),
      ),
    ).toBe(false);
  });

  it('keeps failed treatment negative without inventing a current medicine', () => {
    const plan = analyzeClinicalQuery('парацетамол не помог', []);
    const context = plan.analysis.clinicalContext;
    expect(context).toBeDefined();
    if (!context) return;

    expect(context.negativeFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'negative-finding',
          value: 'парацетамол',
          polarity: 'negative',
        }),
      ]),
    );
    expect(context.currentMedicines).toHaveLength(0);
  });

  it('does not promote negative pregnancy, allergy, or organ assertions', () => {
    const query = 'не беременна, аллергии нет, нет почечной недостаточности';
    const context = contextFor(query);

    expect(context.pregnancy).toEqual([
      expect.objectContaining({ normalizedValue: 'беременность', polarity: 'negative' }),
    ]);
    expect(context.pregnancy.filter((fact) => fact.polarity === 'positive')).toHaveLength(0);
    expect(context.allergies).toEqual([
      expect.objectContaining({ normalizedValue: 'аллергия', polarity: 'negative' }),
    ]);
    expect(context.allergies.filter((fact) => fact.polarity === 'positive')).toHaveLength(0);
    expect(context.organFunction).toEqual([
      expect.objectContaining({
        normalizedValue: 'почечная недостаточность',
        polarity: 'negative',
      }),
    ]);
    expect(context.organFunction.filter((fact) => fact.polarity === 'positive')).toHaveLength(0);
  });

  it.each([
    'без почечной недостаточности',
    'почечной недостаточности нет',
    'нет почечной недостаточности',
  ])('keeps organ assertion negative for %s without swallowing following text', (query) => {
    const fullQuery = `${query}, кашель`;
    const context = contextFor(fullQuery);
    const fact = context.organFunction[0];
    const start = fullQuery.indexOf(query);

    expect(context.organFunction).toHaveLength(1);
    expect(fact).toMatchObject({
      normalizedValue: 'почечная недостаточность',
      polarity: 'negative',
      range: { start, end: start + query.length },
    });
    expect(
      context.organFunction.filter((candidate) => candidate.polarity === 'positive'),
    ).toHaveLength(0);
  });

  it('keeps blood pressure as one measurement and does not call it strength or weight', () => {
    const query = 'АД 200/120, цефтриаксон 1 г';
    const plan = analyzeClinicalQuery(query, []);
    const context = plan.analysis.clinicalContext;
    expect(context).toBeDefined();
    if (!context) return;

    expect(context.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'АД 200/120',
          normalizedValue: '200/120',
          unit: 'мм рт. ст.',
        }),
      ]),
    );
    expect(context.measurements.filter((fact) => fact.value.includes('200/120'))).toHaveLength(1);
    expect(context.weight).toHaveLength(0);
    expect(context.strength).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: '1 г', normalizedValue: '1 г' })]),
    );
  });

  it('keeps child weight separate from ceftriaxone vial strength', () => {
    const query = 'ребёнок 30 кг, цефтриаксон 1 г во флаконе';
    const plan = analyzeClinicalQuery(query, []);
    const context = plan.analysis.clinicalContext;
    expect(context).toBeDefined();
    if (!context) return;

    const weightStart = query.indexOf('30 кг');
    expect(context.weight).toEqual([
      expect.objectContaining({
        kind: 'weight',
        value: '30 кг',
        normalizedValue: '30 кг',
        unit: 'кг',
        range: { start: weightStart, end: weightStart + '30 кг'.length },
      }),
    ]);

    const strengthStart = query.indexOf('1 г во флаконе');
    expect(context.strength).toEqual([
      expect.objectContaining({
        kind: 'strength',
        value: '1 г во флаконе',
        normalizedValue: '1 г',
        unit: 'г',
        range: {
          start: strengthStart,
          end: strengthStart + '1 г во флаконе'.length,
        },
      }),
    ]);
    expect(context.weight.some((fact) => fact.value.includes('1 г'))).toBe(false);
    expect(
      context.measurements.some((fact) => fact.label === 'Масса' && fact.value.includes('1 г')),
    ).toBe(false);
  });

  it('maps в/в to внутривенно with the exact source range', () => {
    const query = 'цефтриаксон в/в';
    const context = contextFor(query);
    const fact = factFor(context, 'route', 'в/в');
    const start = query.indexOf('в/в');

    expect(fact).toMatchObject({
      kind: 'route',
      value: 'в/в',
      normalizedValue: 'внутривенно',
      unit: null,
      range: { start, end: start + 'в/в'.length },
    });
  });

  it('preserves failed-treatment negation and syrup/спироп search expansion', () => {
    const negative = analyzeClinicalQuery(
      'Нет ответа на стартовый антибиотик через 48–72 часа при пневмонии',
      [],
    );
    expect(negative.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'negative-finding',
          normalizedValue: 'ответа на стартовый антибиотик',
        }),
      ]),
    );
    expect(buildLexicalQueryPlan('сироп', []).terms).toContain('суспензия для приема внутрь');
    expect(buildLexicalQueryPlan('спироп', []).terms).toContain('суспензия для приема внутрь');
  });
});

interface ScenarioVariant {
  readonly text: string;
  readonly expected: readonly [ContextCase['field'], string, string, QueryFactPolarity?];
}

interface ScenarioFragment {
  readonly variants: readonly ScenarioVariant[];
}

const DOSE_SCENARIO: readonly ScenarioFragment[] = [
  {
    variants: [
      { text: 'ребёнок 12 лет', expected: ['age', 'ребёнок 12 лет', '12 лет'] },
      { text: 'РЕБЕНОК 12 ЛЕТ', expected: ['age', 'РЕБЕНОК 12 ЛЕТ', '12 лет'] },
    ],
  },
  {
    variants: [
      { text: 'вес 30 кг', expected: ['weight', 'вес 30 кг', '30 кг'] },
      { text: 'весом 30кг', expected: ['weight', 'весом 30кг', '30 кг'] },
    ],
  },
  {
    variants: [
      { text: 'в/м', expected: ['route', 'в/м', 'внутримышечно'] },
      { text: 'вм', expected: ['route', 'вм', 'внутримышечно'] },
      { text: 'внутримышечно', expected: ['route', 'внутримышечно', 'внутримышечно'] },
    ],
  },
  {
    variants: [
      { text: 'суспензия', expected: ['doseForm', 'суспензия', 'суспензия'] },
      { text: 'СИРОП', expected: ['doseForm', 'СИРОП', 'сироп'] },
    ],
  },
  {
    variants: [
      { text: '100 мг/5 мл', expected: ['strength', '100 мг/5 мл', '100 мг/5 мл'] },
      { text: '100 мг в 5 мл', expected: ['strength', '100 мг в 5 мл', '100 мг/5 мл'] },
    ],
  },
  {
    variants: [
      { text: '2 раза в день', expected: ['frequency', '2 раза в день', '2 раза в сутки'] },
      { text: 'дважды в сутки', expected: ['frequency', 'дважды в сутки', '2 раза в сутки'] },
      { text: '1-0-1', expected: ['frequency', '1-0-1', '1-0-1'] },
    ],
  },
];

const STATE_SCENARIO: readonly ScenarioFragment[] = [
  {
    variants: [
      { text: '12-летнему', expected: ['age', '12-летнему', '12 лет'] },
      { text: 'полтора года', expected: ['age', 'полтора года', '18 месяцев'] },
      { text: '6 мес', expected: ['age', '6 мес', '6 месяцев'] },
      { text: 'новорождённый', expected: ['age', 'новорождённый', 'неонатальный период'] },
    ],
  },
  {
    variants: [
      {
        text: '34 недели гестации',
        expected: ['gestationalAge', '34 недели гестации', '34 недели'],
      },
      {
        text: 'беременность 20 недель',
        expected: ['gestationalAge', '20 недель', '20 недель'],
      },
    ],
  },
  {
    variants: [
      {
        text: 'беременность 20 недель',
        expected: ['pregnancy', 'беременность 20 недель', 'беременность'],
      },
      { text: 'не беременна', expected: ['pregnancy', 'не беременна', 'беременность', 'negative'] },
    ],
  },
  {
    variants: [
      {
        text: 'почечная недостаточность',
        expected: ['organFunction', 'почечная недостаточность', 'почечная недостаточность'],
      },
      {
        text: 'печёночная недостаточность',
        expected: ['organFunction', 'печёночная недостаточность', 'печеночная недостаточность'],
      },
      {
        text: 'нет почечной недостаточности',
        expected: [
          'organFunction',
          'нет почечной недостаточности',
          'почечная недостаточность',
          'negative',
        ],
      },
    ],
  },
  {
    variants: [
      {
        text: 'аллергия на пенициллин',
        expected: ['allergies', 'аллергия на пенициллин', 'аллергия на пенициллин'],
      },
      {
        text: 'аллергии нет',
        expected: ['allergies', 'аллергии нет', 'аллергия', 'negative'],
      },
    ],
  },
];

function seededNext(seed: number): number {
  return (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
}

function renderSeededScenario(
  seed: number,
  scenario: readonly ScenarioFragment[] = DOSE_SCENARIO,
): {
  query: string;
  expected: readonly ScenarioVariant[];
} {
  let state = seed >>> 0;
  const selected = scenario.map((fragment) => {
    state = seededNext(state);
    return fragment.variants[state % fragment.variants.length] as ScenarioVariant;
  });
  const order = selected.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    state = seededNext(state);
    const swapIndex = state % (index + 1);
    [order[index], order[swapIndex]] = [order[swapIndex] as number, order[index] as number];
  }
  const separators = [', ', '; ', ' . ', '  '];
  const query = order
    .map((index, position) => {
      state = seededNext(state);
      const separator = position === 0 ? '' : separators[state % separators.length];
      return `${separator}${selected[index]?.text ?? ''}`;
    })
    .join('');
  return { query, expected: selected };
}

describe('seeded dose-context regression renderer', () => {
  it.each([0x20260831, 0x5eed, 0xc0ffee])('keeps semantic facts under seed %#', (seed) => {
    const rendered = renderSeededScenario(seed);
    const context = contextFor(rendered.query);

    for (const variant of rendered.expected) {
      const [field, raw, normalizedValue, polarity = 'positive'] = variant.expected;
      const fact = factFor(context, field, raw);
      expect(fact.normalizedValue).toBe(normalizedValue);
      expect(fact.polarity).toBe(polarity);
      expect(fact.range).toEqual({
        start: rendered.query.indexOf(raw),
        end: rendered.query.indexOf(raw) + raw.length,
      });
    }
  });

  it('renders the same fixed seed identically', () => {
    expect(renderSeededScenario(0x20260831)).toEqual(renderSeededScenario(0x20260831));
  });

  it.each([0x20260831, 0x5eed, 0xc0ffee])('keeps state facts under seed %#', (seed) => {
    const rendered = renderSeededScenario(seed, STATE_SCENARIO);
    const context = contextFor(rendered.query);

    for (const variant of rendered.expected) {
      const [field, raw, normalizedValue, polarity = 'positive'] = variant.expected;
      const fact = factFor(context, field, raw);
      expect(fact.normalizedValue).toBe(normalizedValue);
      expect(fact.polarity).toBe(polarity);
      expect(fact.range).toEqual({
        start: rendered.query.indexOf(raw),
        end: rendered.query.indexOf(raw) + raw.length,
      });
    }
  });
});
