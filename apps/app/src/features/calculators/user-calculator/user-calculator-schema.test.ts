import { describe, expect, it } from 'vitest';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import {
  bandForResult,
  defaultSampleValues,
  previewUserCalculator,
  sampleResultRange,
  USER_CALCULATOR_RESULT_STEP_ID,
  userCalculatorBlockingError,
  userCalculatorIssues,
  userCalculatorToSchema,
} from '@/features/calculators/user-calculator/user-calculator-schema';
import { filterByAge } from '@/features/tools/tool-age-filter';
import { toolAgeBadge } from '@/features/tools/tool-age-scope';
import { newUserCalculator, type UserCalculator } from '@/state/user-calculators';

function withoutPopulation(model: UserCalculator): UserCalculator {
  const { population: _removed, ...rest } = model;
  return rest;
}

function bmi(overrides: Partial<UserCalculator> = {}): UserCalculator {
  return {
    ...newUserCalculator('2026-10-05T10:00:00.000Z'),
    id: 'uc-bmi000000001',
    title: 'ИМТ',
    description: 'Индекс массы тела',
    population: { group: 'adults' },
    inputs: [
      {
        id: 'x1',
        name: 'масса',
        label: 'Масса',
        unit: 'кг',
        minimum: 20,
        maximum: 300,
        integer: false,
      },
      {
        id: 'x2',
        name: 'рост',
        label: 'Рост',
        unit: 'см',
        minimum: 50,
        maximum: 250,
        integer: true,
      },
    ],
    result: { label: 'Индекс массы тела', unit: 'кг/м²', decimals: 1 },
    formula: 'масса / (рост / 100) ^ 2',
    bands: [
      { id: 'b1', max: 18.4, headline: 'Дефицит', message: 'ИМТ ниже нормы.' },
      { id: 'b2', min: 18.5, max: 24.9, headline: 'Норма', message: 'Масса соответствует росту.' },
      { id: 'b3', min: 25, headline: 'Избыток', message: '' },
    ],
    ...overrides,
  };
}

function run(model: UserCalculator, values: Record<string, string>) {
  const evaluation = evaluateCalculatorSchema(userCalculatorToSchema(model), values);
  if (!evaluation.ok) throw new Error(evaluation.error);
  return evaluation;
}

function messages(model: UserCalculator, severity: 'error' | 'warning'): string[] {
  return userCalculatorIssues(model)
    .filter((issue) => issue.severity === severity)
    .map((issue) => issue.message);
}

describe('model → schema', () => {
  it('produces a schema the validator accepts, with the calculator’s identity and wording', () => {
    const schema = userCalculatorToSchema(bmi());
    expect(validateCalculatorSchema(schema)).toMatchObject({ ok: true });
    expect(schema).toMatchObject({
      schemaVersion: 2,
      id: 'user-calculator:uc-bmi000000001',
      slug: 'uc-bmi000000001',
      title: 'ИМТ',
      shortTitle: 'ИМТ',
      summary: 'Индекс массы тела',
      category: 'custom',
      clinical: false,
      formulaDisplay: 'масса / (рост / 100) ^ 2',
      limitations: ['Авторский калькулятор. Результат не заменяет клиническую оценку.'],
      evaluation: { status: 'not-applicable', rules: [], missingContext: [] },
      observationMappings: [],
    });
    expect(schema.population).toBe('Взрослые. Указано автором калькулятора.');
    expect(schema.sources).toEqual([
      {
        title: 'Авторский калькулятор',
        publisher: 'Создан пользователем',
        version: '1',
        reviewedAt: '2026-10-05',
      },
    ]);
    expect(schema.inputs).toEqual([
      expect.objectContaining({
        id: 'x1',
        label: 'Масса',
        unit: 'кг',
        kind: 'number',
        minimum: 20,
        maximum: 300,
        required: true,
        step: 0,
      }),
      expect.objectContaining({ id: 'x2', unit: 'см', integer: true, required: true }),
    ]);
    const result = schema.steps.find((step) => step.id === USER_CALCULATOR_RESULT_STEP_ID);
    expect(result).toMatchObject({
      isOutput: true,
      valueKind: 'number',
      unit: 'кг/м²',
      displayPrecision: 1,
      label: 'Индекс массы тела',
    });
  });

  it('uses «ед.» for a result without a unit, and a fallback summary without a description', () => {
    const schema = userCalculatorToSchema(
      bmi({ result: { label: 'Балл', unit: '', decimals: 0 }, description: '', bands: [] }),
    );
    expect(schema.steps[0]?.unit).toBe('ед.');
    expect(schema.summary).toBe('Авторский калькулятор: Балл.');
    expect(schema.steps).toHaveLength(1);
    expect(schema.interpretations).toEqual([]);
  });

  it('carries the disclaimer into every result so it reaches the printout', () => {
    const evaluation = run(bmi({ disclaimer: 'Только для обучения.' }), { x1: '70', x2: '170' });
    expect(evaluation.warnings).toContainEqual({
      code: 'user-disclaimer',
      message: 'Только для обучения.',
    });
  });

  it('refuses a calculator that is not finished, with the first problem as the message', () => {
    expect(() => userCalculatorToSchema(withoutPopulation(bmi()))).toThrow(
      'Укажите, для кого инструмент',
    );
    expect(() => userCalculatorToSchema(bmi({ formula: 'вес * 2' }))).toThrow(
      'Формула: Нет такой переменной «вес».',
    );
  });
});

describe('evaluation through the real engine', () => {
  it('computes the BMI and picks the band', () => {
    const deficit = run(bmi(), { x1: '49', x2: '170' });
    expect(deficit.outputs[0]).toMatchObject({
      kind: 'number',
      unit: 'кг/м²',
      displayPrecision: 1,
    });
    expect(deficit.outputs[0]?.kind === 'number' ? deficit.outputs[0].value : 0).toBeCloseTo(
      49 / 1.7 ** 2,
      10,
    );
    expect(deficit.warnings.map((warning) => warning.message)).toContain(
      'Дефицит. ИМТ ниже нормы.',
    );

    const normal = run(bmi(), { x1: '63.58', x2: '170' });
    expect(normal.warnings.map((warning) => warning.message)).toContain(
      'Норма. Масса соответствует росту.',
    );
    // A band without an explanation reads as its headline alone.
    const excess = run(bmi(), { x1: '90', x2: '170' });
    expect(excess.warnings.map((warning) => warning.message)).toContain('Избыток');
  });

  it('shows the rounding step in the trace only when there are ranges', () => {
    expect(run(bmi(), { x1: '70', x2: '170' }).trace.map((step) => step.id)).toEqual([
      'result',
      'result_rounded',
    ]);
    expect(run(bmi({ bands: [] }), { x1: '70', x2: '170' }).trace.map((step) => step.id)).toEqual([
      'result',
    ]);
  });

  it('compares a range with the result rounded to the displayed decimals', () => {
    const model = bmi({
      formula: 'масса',
      inputs: [{ id: 'x1', name: 'масса', label: 'Масса', unit: '', integer: false }],
    });
    const headline = (value: string): string | undefined =>
      run(model, { x1: value }).warnings.find((warning) => warning.code === 'interpretation')
        ?.message;
    // 24.93 is shown as 24.9 and therefore «Норма»; 24.95 is shown as 25.0 and therefore «Избыток».
    expect(headline('24.93')).toContain('Норма');
    expect(headline('24.96')).toBe('Избыток');
    expect(headline('18.45')).toBe('Норма. Масса соответствует росту.');
    expect(headline('18.44')).toBe('Дефицит. ИМТ ниже нормы.');
    // A boundary belongs to its band.
    expect(headline('18.5')).toContain('Норма');
    expect(headline('24.9')).toContain('Норма');
    expect(headline('25')).toBe('Избыток');
  });

  it('handles negative limits, open ends and a catch-all range', () => {
    const model = bmi({
      formula: 'масса',
      inputs: [{ id: 'x1', name: 'масса', label: 'Масса', unit: '', integer: false }],
      result: { label: 'Баланс', unit: '', decimals: 0 },
      bands: [
        { id: 'b1', max: -5, headline: 'Сильно ниже', message: '' },
        { id: 'b2', min: -4, max: 4, headline: 'Около нуля', message: '' },
      ],
    });
    const headline = (value: string) =>
      run(model, { x1: value }).warnings.find((warning) => warning.code === 'interpretation')
        ?.message;
    expect(headline('-100')).toBe('Сильно ниже');
    expect(headline('-4')).toBe('Около нуля');
    expect(headline('0.4')).toBe('Около нуля');
    expect(headline('50')).toBeUndefined();
    const catchAll = bmi({ ...model, bands: [{ id: 'b1', headline: 'Всегда', message: '' }] });
    expect(
      run(catchAll, { x1: '3' }).warnings.some((warning) => warning.message === 'Всегда'),
    ).toBe(true);
  });

  it('the band tester agrees with the engine for every value on a fine sweep', () => {
    const model = bmi({
      formula: 'масса',
      inputs: [{ id: 'x1', name: 'масса', label: 'Масса', unit: '', integer: false }],
    });
    const schema = userCalculatorToSchema(model);
    for (let value = 10; value <= 35; value += 0.037) {
      const evaluation = evaluateCalculatorSchema(schema, { x1: value });
      if (!evaluation.ok) throw new Error(evaluation.error);
      const fired = evaluation.warnings.find((warning) => warning.code === 'interpretation');
      const tested = bandForResult(model, value);
      const expected = tested
        ? tested.band.message
          ? `${tested.band.headline}. ${tested.band.message}`
          : tested.band.headline
        : undefined;
      expect(fired?.message, `value ${value}`).toBe(expected);
    }
  });

  it('runs formulas with functions, decimal commas and comparisons', () => {
    const model = bmi({
      formula: 'cond(возраст >= 18; max(масса; 1) × 2,5; масса)',
      inputs: [
        { id: 'x1', name: 'масса', label: 'Масса', unit: '', integer: false },
        { id: 'x2', name: 'возраст', label: 'Возраст', unit: '', integer: true },
      ],
      bands: [],
    });
    const value = (values: Record<string, string>) => {
      const output = run(model, values).outputs[0];
      return output?.kind === 'number' ? output.value : Number.NaN;
    };
    expect(value({ x1: '10', x2: '20' })).toBe(25);
    expect(value({ x1: '10', x2: '5' })).toBe(10);
  });

  it('enforces the author’s limits and the integer flag with the engine’s messages', () => {
    const schema = userCalculatorToSchema(bmi());
    expect(evaluateCalculatorSchema(schema, { x1: '10', x2: '170' })).toEqual({
      ok: false,
      error: 'Масса: значение меньше допустимого минимума 20.',
    });
    expect(evaluateCalculatorSchema(schema, { x1: '70', x2: '170.5' })).toEqual({
      ok: false,
      error: 'Рост: требуется целое число.',
    });
    expect(evaluateCalculatorSchema(schema, { x1: '70', x2: '' })).toEqual({
      ok: false,
      error: 'Рост: значение обязательно.',
    });
  });
});

describe('age scope and population', () => {
  it('turns the population into the age scope the lists filter by', () => {
    const children = userCalculatorToSchema(
      bmi({ population: { group: 'children', minAge: { value: 2, unit: 'years' } } }),
    );
    expect(children.ageScope.groups).toEqual(['children']);
    expect(children.ageScope.minAge).toEqual({ value: 2, unit: 'years' });
    expect(toolAgeBadge(children.ageScope).label).toBe('Дети от 2 лет');
    expect(children.population).toBe('Дети от 2 лет. Указано автором калькулятора.');

    const adults = userCalculatorToSchema(bmi());
    const any = userCalculatorToSchema(bmi({ population: { group: 'any' } }));
    expect(filterByAge([children, adults, any], 'adults')).toEqual([adults, any]);
    expect(filterByAge([children, adults, any], 'children')).toEqual([children, any]);
    expect(filterByAge([children, adults, any], 'all')).toHaveLength(3);
  });

  it('cannot run until the author states the population', () => {
    expect(userCalculatorBlockingError(withoutPopulation(bmi()))).toBe(
      'Укажите, для кого инструмент: дети, взрослые или любой возраст.',
    );
    expect(
      userCalculatorBlockingError(
        bmi({
          population: {
            group: 'children',
            minAge: { value: 12, unit: 'years' },
            maxAge: { value: 3, unit: 'years' },
          },
        }),
      ),
    ).toBe('Нижняя граница возраста больше верхней: поменяйте их местами.');
  });
});

describe('issues the editor shows', () => {
  it('is quiet for a finished calculator', () => {
    expect(userCalculatorIssues(bmi())).toEqual([]);
    expect(userCalculatorBlockingError(bmi())).toBeNull();
  });

  it('asks for every missing piece in plain Russian', () => {
    const empty = newUserCalculator();
    expect(messages({ ...empty, title: '', disclaimer: ' ' }, 'error')).toEqual([
      'Название: заполните это поле.',
      'Ограничение: заполните это поле.',
      'Укажите, для кого инструмент: дети, взрослые или любой возраст.',
      'Входные данные: добавьте хотя бы одни.',
      'Формула: заполните это поле.',
    ]);
  });

  it('names the input a problem belongs to', () => {
    const base = bmi();
    const [first, second] = base.inputs;
    if (!first || !second) throw new Error('fixture');
    expect(
      messages(
        {
          ...base,
          inputs: [
            { ...first, label: '' },
            { ...second, name: 'max' },
          ],
        },
        'error',
      ),
    ).toEqual([
      'Данные 1: подпись — заполните это поле.',
      'Данные 2 «Рост»: Имя «max» занято функцией: выберите другое.',
      'Формула: Нет такой переменной «рост». Доступны: масса.',
    ]);
    expect(messages({ ...base, inputs: [first, { ...second, name: 'Масса' }] }, 'error')).toContain(
      'Данные 2 «Рост»: Имя «Масса» уже используется другими данными.',
    );
    expect(
      messages({ ...base, inputs: [{ ...first, minimum: 10, maximum: 5 }, second] }, 'error'),
    ).toContain('Данные 1 «Масса»: минимум больше максимума.');
  });

  it('reports a formula that does not read, a missing result name and a missing headline', () => {
    expect(messages(bmi({ formula: 'масса / (' }), 'error')).toEqual([
      'Формула: Незакрытая скобка в позиции 9.',
    ]);
    expect(messages(bmi({ result: { label: ' ', unit: '', decimals: 1 } }), 'error')).toContain(
      'Результат, название: заполните это поле.',
    );
    const model = bmi();
    expect(
      messages({ ...model, bands: [{ id: 'b1', headline: '', message: 'x' }] }, 'error'),
    ).toEqual(['Диапазон 1: заголовок — заполните это поле.']);
  });

  it('reports ranges that are reversed or overlap, but never counts touching bounds as free', () => {
    const model = bmi();
    expect(
      messages(
        { ...model, bands: [{ id: 'b1', min: 5, max: 1, headline: 'Наоборот', message: '' }] },
        'error',
      ),
    ).toEqual(['Диапазон 1 «Наоборот»: «от» больше «до» — поменяйте границы местами.']);
    const overlapping = messages(
      {
        ...model,
        bands: [
          { id: 'b1', max: 20, headline: 'A', message: '' },
          { id: 'b2', min: 18, max: 30, headline: 'B', message: '' },
        ],
      },
      'error',
    );
    expect(overlapping).toEqual([
      expect.stringContaining('Диапазоны 1 и 2 пересекаются: значения от 18 до 20 попадают в оба.'),
    ]);
    const touching = messages(
      {
        ...model,
        bands: [
          { id: 'b1', max: 20, headline: 'A', message: '' },
          { id: 'b2', min: 20, headline: 'B', message: '' },
        ],
      },
      'error',
    );
    expect(touching).toEqual([expect.stringContaining('значение 20 попадает в оба')]);
    const unbounded = messages(
      {
        ...model,
        bands: [
          { id: 'b1', headline: 'A', message: '' },
          { id: 'b2', min: 1, headline: 'B', message: '' },
        ],
      },
      'error',
    );
    expect(unbounded).toEqual([expect.stringContaining('Диапазоны 1 и 2 пересекаются')]);
  });

  it('warns, without blocking, about a gap between ranges on the grid of the shown decimals', () => {
    const model = bmi();
    expect(
      messages(
        {
          ...model,
          bands: [
            { id: 'b1', max: 18.4, headline: 'A', message: '' },
            { id: 'b2', min: 18.6, headline: 'B', message: '' },
          ],
        },
        'warning',
      ),
    ).toEqual([
      'Между диапазонами 1 и 2 есть пропуск: результаты от 18,5 до 18,5 не попадут ни в один диапазон.',
    ]);
    // 18.4 → 18.5 on one decimal leaves nothing between them.
    expect(messages(model, 'warning')).toEqual([]);
    expect(
      userCalculatorBlockingError({
        ...model,
        bands: [
          { id: 'b1', max: 18.4, headline: 'A', message: '' },
          { id: 'b2', min: 18.6, headline: 'B', message: '' },
        ],
      }),
    ).toBeNull();
  });

  it('warns about an input the formula never uses', () => {
    expect(messages(bmi({ formula: 'масса * 2', bands: [] }), 'warning')).toEqual([
      'Данные 2 «Рост»: не используется в формуле.',
    ]);
  });

  it('warns when a range lies outside every result the allowed data can give', () => {
    const range = sampleResultRange(bmi());
    expect(range?.minimum).toBeCloseTo(20 / 2.5 ** 2, 10);
    expect(range?.maximum).toBeCloseTo(300 / 0.5 ** 2, 10);
    const model = bmi({
      formula: 'масса / 10',
      inputs: [
        {
          id: 'x1',
          name: 'масса',
          label: 'Масса',
          unit: '',
          minimum: 10,
          maximum: 50,
          integer: false,
        },
      ],
      bands: [
        { id: 'b1', min: 1, max: 5, headline: 'Возможно', message: '' },
        { id: 'b2', min: 40, headline: 'Невозможно', message: '' },
      ],
    });
    expect(messages(model, 'warning')).toEqual([
      expect.stringContaining('Между диапазонами 1 и 2 есть пропуск'),
      'Диапазон 2 «Невозможно» (от 40) лежит вне возможных значений результата: при допустимых данных он получается от 1 до 5 (проверены крайние значения данных).',
    ]);
  });

  it('skips the range check when the data have no limits or the formula fails at a corner', () => {
    expect(
      sampleResultRange(
        bmi({
          inputs: [{ id: 'x1', name: 'масса', label: 'Масса', unit: '', integer: false }],
          formula: 'масса',
        }),
      ),
    ).toBeNull();
    const divides = bmi({
      formula: '1 / масса',
      inputs: [
        {
          id: 'x1',
          name: 'масса',
          label: 'Масса',
          unit: '',
          minimum: 0,
          maximum: 10,
          integer: false,
        },
      ],
    });
    expect(sampleResultRange(divides)).toBeNull();
  });
});

describe('live preview', () => {
  it('suggests sample values from the allowed range', () => {
    expect(defaultSampleValues(bmi())).toEqual({ x1: '160', x2: '150' });
    const half = bmi({
      inputs: [
        { id: 'x1', name: 'a', label: 'A', unit: '', minimum: 3, integer: false },
        { id: 'x2', name: 'b', label: 'B', unit: '', maximum: 9, integer: false },
        { id: 'x3', name: 'c', label: 'C', unit: '', integer: false },
      ],
    });
    expect(defaultSampleValues(half)).toEqual({ x1: '3', x2: '9' });
  });

  it('shows the result with its unit and the range it falls in', () => {
    expect(previewUserCalculator(bmi(), { x1: '63.58', x2: '170' })).toEqual({
      ok: true,
      value: expect.closeTo(22, 3),
      display: '22 кг/м²',
      bandMessage: 'Норма. Масса соответствует росту.',
    });
  });

  it('previews a calculator that is not finished yet', () => {
    expect(
      previewUserCalculator(withoutPopulation(bmi({ title: '', disclaimer: '' })), {
        x1: '70',
        x2: '170',
      }),
    ).toMatchObject({ ok: true });
    expect(
      previewUserCalculator(
        bmi({
          population: {
            group: 'children',
            minAge: { value: 12, unit: 'years' },
            maxAge: { value: 3, unit: 'years' },
          },
        }),
        { x1: '70', x2: '170' },
      ),
    ).toMatchObject({ ok: true });
  });

  it('turns a non-finite result into plain advice instead of an engine message', () => {
    const model = bmi({
      formula: 'масса / рост',
      inputs: [
        { id: 'x1', name: 'масса', label: 'Масса', unit: '', integer: false },
        { id: 'x2', name: 'рост', label: 'Рост', unit: '', integer: false },
      ],
    });
    expect(previewUserCalculator(model, { x1: '5', x2: '0' })).toEqual({
      ok: false,
      error:
        'При этих значениях формула не даёт числа: проверьте деление на ноль и корень из отрицательного.',
    });
    expect(
      previewUserCalculator(bmi({ formula: 'sqrt(масса - 100)' }), { x1: '50', x2: '170' }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('не даёт числа'),
    });
  });

  it('passes the engine’s own message for a missing or out-of-range value, and the formula error', () => {
    expect(previewUserCalculator(bmi(), { x1: '', x2: '170' })).toEqual({
      ok: false,
      error: 'Масса: значение обязательно.',
    });
    expect(previewUserCalculator(bmi(), { x1: '500', x2: '170' })).toEqual({
      ok: false,
      error: 'Масса: значение больше допустимого максимума 300.',
    });
    expect(previewUserCalculator(bmi({ formula: 'вес' }), {})).toEqual({
      ok: false,
      error: 'Нет такой переменной «вес». Доступны: масса, рост.',
    });
    expect(previewUserCalculator(bmi({ inputs: [], formula: '2' }), {})).toEqual({
      ok: false,
      error: 'Добавьте хотя бы одни входные данные.',
    });
  });
});
