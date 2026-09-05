import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CalculatorSchemaSchema, ToolDefinitionRecordSchema } from '@localmed/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDownloadedCalculators,
  registerDownloadedCalculator,
  searchCalculators,
} from '@/features/calculators/calculator-registry';
import {
  calculatorSchemaInputsReady,
  evaluateCalculatorSchema,
  initialCalculatorSchemaValues,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import { calculateWhoGrowthZScore } from '@/features/calculators/who-growth-reference-data';
import {
  appendEvent,
  createPatientProfile,
  emptyPatientVaultSnapshot,
  type PatientVaultSnapshot,
} from '@/state/patient-domain';
import { patientBoundCalculatorInputs } from '@/state/patient-tool-recording';

const GROWTH_FILE = resolve(process.cwd(), 'content/tool-modules/pediatrics-growth.json');

function loadGrowthSchema(): ReturnType<typeof CalculatorSchemaSchema.parse> {
  const module = JSON.parse(readFileSync(GROWTH_FILE, 'utf8')) as { tools: unknown[] };
  const record = ToolDefinitionRecordSchema.parse(module.tools[0]);
  return CalculatorSchemaSchema.parse(record.definition);
}

function loadBloodPressureSchema(): ReturnType<typeof CalculatorSchemaSchema.parse> {
  const module = JSON.parse(readFileSync(GROWTH_FILE, 'utf8')) as { tools: unknown[] };
  const record = ToolDefinitionRecordSchema.parse(module.tools[1]);
  return CalculatorSchemaSchema.parse(record.definition);
}

function outputIds(
  result: Extract<ReturnType<typeof evaluateCalculatorSchema>, { readonly ok: true }>,
): readonly string[] {
  return result.outputs.filter((output) => output.kind === 'number').map((output) => output.id);
}

describe('WHO pediatric anthropometry calculator', () => {
  afterEach(() => {
    vi.useRealTimers();
    clearDownloadedCalculators();
  });

  it('prefills the measurement date with today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12));

    expect(initialCalculatorSchemaValues(loadGrowthSchema())['measurement_date']).toBe(
      '2026-09-03',
    );
  });

  it('uses concise Russian labels, tooltips, and date-of-birth input gating', () => {
    const schema = loadGrowthSchema();
    const inputs = schema.inputs;
    expect(inputs.find((input) => input.id === 'biological_sex')?.label).toBe('Пол');
    const positionTooltip = inputs.find((input) => input.id === 'measure_position')?.labelTooltip;
    expect(positionTooltip).toContain('до 2 лет');
    expect(positionTooltip).not.toMatch(/731|дн(?:я|ей)/u);
    expect(inputs.find((input) => input.id === 'length_height_cm')?.labelTooltip).toContain(
      '45–110 см',
    );
    const weightInput = inputs.find((input) => input.id === 'weight_g');
    expect(weightInput).toMatchObject({ unit: 'г', minimum: 100, maximum: 250_000, inputStep: 1 });
    expect(
      (weightInput?.patientBinding as { readonly valueMultiplier?: number } | undefined)
        ?.valueMultiplier,
    ).toBe(1_000);
    expect(inputs.slice(1).every((input) => input.requiresInput === 'date_of_birth')).toBe(true);
    expect(schema.inputRequirements).toEqual([
      {
        kind: 'atLeastOne',
        inputIds: ['length_height_cm', 'weight_g', 'head_circumference_cm', 'arm_circumference_cm'],
        message: 'Заполните хотя бы один антропометрический показатель.',
      },
    ]);
    expect(
      calculatorSchemaInputsReady(schema, {
        ...initialCalculatorSchemaValues(schema),
        date_of_birth: '2026-01-01',
      }),
    ).toBe(false);
    expect(
      calculatorSchemaInputsReady(schema, {
        ...initialCalculatorSchemaValues(schema),
        date_of_birth: '2026-01-01',
        weight_g: '7500',
      }),
    ).toBe(true);
  });

  it('prefills a kilogram patient observation as grams', () => {
    const created = createPatientProfile({
      id: 'patient-1',
      displayName: 'Ребёнок',
      weightKg: 7.5,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    let snapshot: PatientVaultSnapshot = {
      ...emptyPatientVaultSnapshot(),
      profiles: [created.profile],
    };
    for (const event of created.initialEvents) snapshot = appendEvent(snapshot, event);

    expect(
      patientBoundCalculatorInputs(
        loadGrowthSchema(),
        created.profile,
        snapshot,
        '2026-09-03T00:00:00.000Z',
      )['weight_g'],
    ).toBe(7_500);
  });

  it.each([
    'z-score дети',
    'z-score для детей',
    'перцентили детей',
    'детский рост',
    'детский вес',
    'окружность головы',
  ])('is searchable as "%s"', (query) => {
    const module = JSON.parse(readFileSync(GROWTH_FILE, 'utf8')) as { tools: unknown[] };
    const record = ToolDefinitionRecordSchema.parse(module.tools[0]);
    registerDownloadedCalculator(record);

    expect(searchCalculators(query).map((calculator) => calculator.id)).toContain(record.id);
  });

  it('passes the schema trust boundary and contains no demo or approximation marker', () => {
    const schema = loadGrowthSchema();
    const result = validateCalculatorSchema(schema);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(schema).toLowerCase()).not.toMatch(/demo|approx/u);
  });

  it('matches the published WHO Anthro example for a 1001-day-old boy', () => {
    expect(calculateWhoGrowthZScore('who0-hfa', 'male', 1001, 120)).toBeCloseTo(7.31, 2);
    expect(calculateWhoGrowthZScore('who0-wfa', 'male', 1001, 18)).toBeCloseTo(2.2, 2);
    expect(calculateWhoGrowthZScore('who0-bmi', 'male', 1001, 12.5)).toBeCloseTo(-3.01, 2);
  });

  it('calculates every filled 0–5 indicator and emits one common chart per z-score', () => {
    const result = evaluateCalculatorSchema(loadGrowthSchema(), {
      date_of_birth: '2025-01-01',
      measurement_date: '2025-07-01',
      biological_sex: 'female',
      measure_position: 'auto',
      length_height_cm: 65,
      weight_g: 7_500,
      head_circumference_cm: 42,
      arm_circumference_cm: 15,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(outputIds(result)).toEqual([
      'age_months',
      'bmi',
      'who0_hfa_z',
      'who0_hfa_percentile',
      'who0_wfa_z',
      'who0_wfa_percentile',
      'who0_wfl_z',
      'who0_wfl_percentile',
      'who0_bmi_z',
      'who0_bmi_percentile',
      'who0_hc_z',
      'who0_hc_percentile',
      'who0_muac_z',
      'who0_muac_percentile',
    ]);
    const visuals = result.outputs.filter((output) => output.kind === 'visual');
    expect(visuals).toHaveLength(6);
    expect(visuals.every((visual) => visual.chart.type === 'line')).toBe(true);
    expect(
      visuals.every((visual) => visual.chart.title && visual.chart.xAxis && visual.chart.yAxis),
    ).toBe(true);
    expect(
      visuals.every((visual) =>
        visual.chart.datasets.some(
          (dataset) => dataset.label === 'Ребёнок' && dataset.render === 'point',
        ),
      ),
    ).toBe(true);

    const stored = toStoredCalculationResult(result);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect('values' in stored ? stored.values.map((value) => value.id) : []).toEqual(
      outputIds(result),
    );
    expect(stored.visuals).toHaveLength(6);
  });

  it('switches to WHO 5–19 tables at the supported boundary without using WHO 0–5 outputs', () => {
    const result = evaluateCalculatorSchema(loadGrowthSchema(), {
      date_of_birth: '2016-01-01',
      measurement_date: '2021-01-01',
      biological_sex: 'male',
      measure_position: 'auto',
      length_height_cm: 110,
      weight_g: 20_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(outputIds(result)).toEqual([
      'age_months',
      'bmi',
      'who5_hfa_z',
      'who5_hfa_percentile',
      'who5_wfa_z',
      'who5_wfa_percentile',
      'who5_bmi_z',
      'who5_bmi_percentile',
    ]);
    expect(result.outputs.filter((output) => output.kind === 'visual')).toHaveLength(3);
  });

  it('calculates a single filled optional measurement and omits non-applicable outputs/charts', () => {
    const result = evaluateCalculatorSchema(loadGrowthSchema(), {
      date_of_birth: '2025-01-01',
      measurement_date: '2025-07-01',
      biological_sex: 'female',
      measure_position: 'auto',
      weight_g: 7_500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(outputIds(result)).toEqual(['age_months', 'who0_wfa_z', 'who0_wfa_percentile']);
    expect(result.outputs.filter((output) => output.kind === 'visual')).toHaveLength(1);
  });

  it('omits an indicator outside its size table instead of failing the whole calculation', () => {
    const result = evaluateCalculatorSchema(loadGrowthSchema(), {
      date_of_birth: '2026-01-01',
      measurement_date: '2026-02-01',
      biological_sex: 'female',
      measure_position: 'auto',
      length_height_cm: 40,
      weight_g: 3_500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(outputIds(result)).toContain('who0_hfa_z');
    expect(outputIds(result)).not.toContain('who0_wfl_z');
  });

  it('reports direct table range errors in Russian', () => {
    expect(() => calculateWhoGrowthZScore('who0-wfl', 'female', 40, 3.5)).toThrow(
      'Таблицы ВОЗ «масса к длине/росту» доступны для длины/роста от 45 до 110 см.',
    );
  });

  it('rejects missing measurements and dates outside the supported population instead of extrapolating', () => {
    const schema = loadGrowthSchema();
    expect(
      evaluateCalculatorSchema(schema, {
        date_of_birth: '2025-01-01',
        measurement_date: '2025-07-01',
        biological_sex: 'female',
        measure_position: 'auto',
      }),
    ).toEqual({ ok: false, error: 'Заполните хотя бы один антропометрический показатель.' });

    const outOfRange = evaluateCalculatorSchema(schema, {
      date_of_birth: '2000-01-01',
      measurement_date: '2026-01-01',
      biological_sex: 'female',
      measure_position: 'auto',
      weight_g: 70_000,
    });
    expect(outOfRange).toEqual({
      ok: false,
      error: 'Калькулятор поддерживает детей младше 19 лет.',
    });
  });
});

describe('AAP pediatric blood-pressure calculator', () => {
  it('requires all clinical inputs before enabling calculation', () => {
    const schema = loadBloodPressureSchema();
    const values = {
      ...initialCalculatorSchemaValues(schema),
      date_of_birth: '2014-09-03',
      biological_sex: 'female',
      height_cm: '154.8',
      systolic_bp: '118',
    };
    expect(calculatorSchemaInputsReady(schema, values)).toBe(false);
    expect(calculatorSchemaInputsReady(schema, { ...values, diastolic_bp: '75' })).toBe(true);
  });

  it('matches the published 12-year-old girl boundary and stores BP observations', () => {
    const schema = loadBloodPressureSchema();
    const result = evaluateCalculatorSchema(schema, {
      date_of_birth: '2014-09-03',
      measurement_date: '2026-09-03',
      biological_sex: 'female',
      height_cm: 154.8,
      systolic_bp: 118,
      diastolic_bp: 75,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'height_percentile_column', value: 50 }),
        expect.objectContaining({ id: 'systolic_p90', value: 118 }),
        expect.objectContaining({ id: 'diastolic_p95', value: 78 }),
      ]),
    );
    expect(result.outputs).toContainEqual(
      expect.objectContaining({
        id: 'bp_category',
        text: 'Повышенное артериальное давление',
      }),
    );
    expect(schema.observationMappings.map((mapping) => mapping.metricId)).toContain(
      'blood-pressure-systolic',
    );
  });

  it('switches to fixed adolescent thresholds on the 13th birthday', () => {
    const result = evaluateCalculatorSchema(loadBloodPressureSchema(), {
      date_of_birth: '2013-09-03',
      measurement_date: '2026-09-03',
      biological_sex: 'female',
      height_cm: 154.8,
      systolic_bp: 120,
      diastolic_bp: 80,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outputs).toContainEqual(
      expect.objectContaining({ id: 'bp_category', text: 'Артериальная гипертензия 1-й степени' }),
    );
    expect(result.trace.some((step) => step.id === 'systolic_p90')).toBe(false);
  });
});
