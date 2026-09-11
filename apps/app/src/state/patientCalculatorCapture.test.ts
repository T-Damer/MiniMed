import { CalculatorSchemaSchema } from '@localmed/contracts';
import { expect, it } from 'vitest';
import coreClinical from '../../../../content/tool-modules/core-clinical.json';
import { createPatientProfile } from './patient-domain';
import { capturePatientCalculatorInputs } from './patientCalculatorCapture';

it('captures declared inputs without inventing a birth date or overwriting existing demographics', () => {
  const schema = CalculatorSchemaSchema.parse(
    coreClinical.tools.find((tool) => tool.id === 'minimed.calculator.cockcroft-gault')?.definition,
  );
  const profile = createPatientProfile({ displayName: 'Тест' }).profile;
  const captured = capturePatientCalculatorInputs(profile, schema, {
    ageYears: 42,
    weightKg: 72,
    sex: 'female',
  });
  expect(captured.context).toMatchObject({ ageYears: 42 });
  expect(captured.profile.birthDate).toBeUndefined();
  expect(captured.measurements).toContainEqual({
    metricId: 'body-mass',
    unit: 'кг',
    value: 72,
    inputId: 'weightKg',
  });
  const sexInput = schema.inputs.find((field) => field.patientBinding?.kind === 'biologicalSex');
  if (!sexInput) throw new Error('Missing sex binding');
  expect(
    capturePatientCalculatorInputs(profile, schema, { [sexInput.id]: 'female' }).profile
      .biologicalSex,
  ).toBe('female');
  const existing = { ...profile, biologicalSex: 'male' as const };
  expect(
    capturePatientCalculatorInputs(existing, schema, { [sexInput.id]: 'female' }).profile
      .biologicalSex,
  ).toBe('male');
});
