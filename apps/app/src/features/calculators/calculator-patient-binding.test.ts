import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculatorUsesPatientData } from '@/features/calculators/calculator-schema-catalog';
import {
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import {
  calculatorSchemaFromModules,
  loadToolModuleCalculatorSchemas,
} from '@/features/calculators/tool-module-test-helpers';
import {
  appendEvent,
  createManualMeasurementEvent,
  createPatientProfile,
  emptyPatientVaultSnapshot,
} from '@/state/patient-domain';
import { patientBoundCalculatorInputs } from '@/state/patient-tool-recording';
import { capturePatientCalculatorInputs } from '@/state/patientCalculatorCapture';

const DUE_DATE_IDS = [
  'obstetric-edd-lmp',
  'obstetric-edd-ultrasound',
  'obstetric-edd-conception',
  'obstetric-edd-quickening',
  'obstetric-edd-given-date',
] as const;
const FEEDING_PLAN_ID = 'minimed.calculator.pediatric-feeding-plan';

afterEach(() => {
  vi.useRealTimers();
});

describe('calculators that declare patient data', () => {
  it('every shipped schema reads from or records into the patient card', () => {
    const without = loadToolModuleCalculatorSchemas()
      .filter((schema) => !calculatorUsesPatientData(schema))
      .map((schema) => schema.id);
    expect(without).toEqual([]);
  });

  it.each([...DUE_DATE_IDS, FEEDING_PLAN_ID])('%s passes the schema trust boundary', (id) => {
    expect(validateCalculatorSchema(calculatorSchemaFromModules(id)).errors).toEqual([]);
  });
});

describe('due-date calculators', () => {
  it('fill the dating inputs from the card and write a changed value back', () => {
    const schema = calculatorSchemaFromModules('obstetric-edd-lmp');
    const profile = {
      ...createPatientProfile({ displayName: 'Тест' }).profile,
      context: { lastMenstrualPeriod: '2026-05-01' },
    };
    expect(patientBoundCalculatorInputs(schema, profile, emptyPatientVaultSnapshot())).toEqual({
      lmpDate: '2026-05-01',
    });

    const unchanged = capturePatientCalculatorInputs(profile, schema, { lmpDate: '2026-05-01' });
    expect(unchanged.profile).toBe(profile);
    const changed = capturePatientCalculatorInputs(profile, schema, { lmpDate: '2026-07-10' });
    expect(changed.profile.context).toEqual({ lastMenstrualPeriod: '2026-07-10' });
    expect(changed.context).toMatchObject({ lastMenstrualPeriod: '2026-07-10' });
  });

  it('share the dated gestational age between the ultrasound and the given-date calculators', () => {
    const profile = {
      ...createPatientProfile({ displayName: 'Тест' }).profile,
      context: { gestationalAgeDate: '2026-05-01', gestationalAgeWeeks: 8, gestationalAgeDays: 2 },
    };
    const snapshot = emptyPatientVaultSnapshot();
    expect(
      patientBoundCalculatorInputs(
        calculatorSchemaFromModules('obstetric-edd-ultrasound'),
        profile,
        snapshot,
      ),
    ).toEqual({ examDate: '2026-05-01', gaWeeksAtExam: 8, gaDaysAtExam: 2 });
    expect(
      patientBoundCalculatorInputs(
        calculatorSchemaFromModules('obstetric-edd-given-date'),
        profile,
        snapshot,
      ),
    ).toEqual({ referenceDate: '2026-05-01', gaWeeksGiven: 8, gaDaysGiven: 2 });
  });

  it('place a stored parity only when it is one of the options', () => {
    const schema = calculatorSchemaFromModules('obstetric-edd-quickening');
    const base = createPatientProfile({ displayName: 'Тест' }).profile;
    const snapshot = emptyPatientVaultSnapshot();
    expect(
      patientBoundCalculatorInputs(
        schema,
        { ...base, context: { parity: 'multigravida' } },
        snapshot,
      ),
    ).toEqual({ parity: 'multigravida' });
    expect(
      patientBoundCalculatorInputs(schema, { ...base, context: { parity: 'other' } }, snapshot),
    ).toEqual({});
  });

  it.each([
    ['obstetric-edd-ultrasound', { examDate: '2026-05-01', gaWeeksAtExam: 8, gaDaysAtExam: 2 }],
    ['obstetric-edd-conception', { conceptionDate: '2026-02-15' }],
    ['obstetric-edd-quickening', { quickeningDate: '2026-06-01', parity: 'primigravida' }],
    ['obstetric-edd-given-date', { referenceDate: '2026-05-01', gaWeeksGiven: 8, gaDaysGiven: 2 }],
  ] as const)('%s reports the gestational age today and records it', (id, inputs) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T09:00:00'));
    const schema = calculatorSchemaFromModules(id);
    const evaluation = evaluateCalculatorSchema(schema, inputs);
    if (!evaluation.ok) throw new Error(evaluation.error);
    const trace = (stepId: string) => evaluation.trace.find((step) => step.id === stepId)?.value;
    // The EDD is the same date the calculator prints; the age today is 280 days minus what is left.
    const text = JSON.stringify(toStoredCalculationResult(evaluation));
    expect(text).toContain('Предполагаемая дата родов');
    const weeks = trace('gaWeeks');
    const days = trace('gaDaysRemainder');
    expect(weeks).toBeGreaterThan(0);
    expect(days).toBeGreaterThanOrEqual(0);
    expect(days).toBeLessThan(7);
    expect(schema.observationMappings.map((mapping) => mapping.stepId)).toEqual([
      'gaWeeks',
      'gaDaysRemainder',
    ]);
  });

  it('count the weeks and days from the dating date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T09:00:00'));
    const run = (id: string, inputs: Record<string, string | number>) => {
      const evaluation = evaluateCalculatorSchema(calculatorSchemaFromModules(id), inputs);
      if (!evaluation.ok) throw new Error(evaluation.error);
      return [
        evaluation.trace.find((step) => step.id === 'gaWeeks')?.value,
        evaluation.trace.find((step) => step.id === 'gaDaysRemainder')?.value,
      ];
    };
    // 8 weeks 2 days on 1 May, plus 161 days to 9 October = 219 days.
    expect(
      run('obstetric-edd-ultrasound', {
        examDate: '2026-05-01',
        gaWeeksAtExam: 8,
        gaDaysAtExam: 2,
      }),
    ).toEqual([31, 2]);
    expect(
      run('obstetric-edd-given-date', {
        referenceDate: '2026-05-01',
        gaWeeksGiven: 8,
        gaDaysGiven: 2,
      }),
    ).toEqual([31, 2]);
    // Conception 14 days after the last period: 236 days since 15 February plus 14.
    expect(run('obstetric-edd-conception', { conceptionDate: '2026-02-15' })).toEqual([35, 5]);
    // First movement of a first pregnancy is 18 weeks: 18 weeks plus 130 days since 1 June.
    expect(
      run('obstetric-edd-quickening', { quickeningDate: '2026-06-01', parity: 'primigravida' }),
    ).toEqual([36, 4]);
  });
});

describe('feeding plan', () => {
  const schema = calculatorSchemaFromModules(FEEDING_PLAN_ID);

  it('takes the age in months from the birth date and the latest weight', () => {
    const created = createPatientProfile({
      id: 'child',
      displayName: 'Ребёнок',
      birthDate: '2026-01-10',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    const weighing = createManualMeasurementEvent({
      patientId: 'child',
      occurredAt: '2026-09-20T00:00:00.000Z',
      metricId: 'body-mass',
      label: 'Масса',
      value: 7.4,
      unit: 'кг',
    });
    const snapshot = appendEvent(
      { ...emptyPatientVaultSnapshot(), profiles: [created.profile] },
      weighing,
    );
    const bound = patientBoundCalculatorInputs(
      schema,
      created.profile,
      snapshot,
      '2026-10-09T09:00:00.000Z',
    );
    // 8 months and 29 days: cut to the field's 0.1 step, never rounded up.
    expect(bound['ageMonths']).toBeCloseTo(8.9, 5);
    expect(bound['weightKg']).toBe(7.4);
    // An older weight is not offered for an infant.
    expect(
      patientBoundCalculatorInputs(schema, created.profile, snapshot, '2026-11-20T00:00:00.000Z')[
        'weightKg'
      ],
    ).toBeUndefined();
  });

  it('records the daily volume and energy as observations', () => {
    expect(schema.observationMappings.map((mapping) => [mapping.stepId, mapping.unit])).toEqual([
      ['dailyVolume', 'мл'],
      ['dailyCalories', 'ккал'],
    ]);
    const evaluation = evaluateCalculatorSchema(schema, {
      ageMonths: 4,
      weightKg: 6.5,
      feedingMode: 'formula',
      complementaryStatus: 'not-started',
      intoleranceCategory: 'none',
    });
    if (!evaluation.ok) throw new Error(evaluation.error);
    for (const mapping of schema.observationMappings) {
      expect(evaluation.trace.some((step) => step.id === mapping.stepId)).toBe(true);
    }
  });
});
