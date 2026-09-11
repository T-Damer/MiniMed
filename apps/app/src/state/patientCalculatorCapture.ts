import type { CalculatorSchema } from '@localmed/contracts';
import type { PatientProfile } from '@/state/patient-domain';

/** Capture only schema-declared patient fields; age never becomes an invented birth date. */
export function capturePatientCalculatorInputs(
  profile: PatientProfile,
  schema: CalculatorSchema,
  inputs: Readonly<Record<string, string | number>>,
): {
  readonly profile: PatientProfile;
  readonly context: Readonly<Record<string, string | number>>;
  readonly measurements: readonly {
    metricId: string;
    unit: string;
    value: number;
    inputId: string;
  }[];
} {
  let next = profile;
  const context: Record<string, string | number> = {};
  const measurements: { metricId: string; unit: string; value: number; inputId: string }[] = [];
  for (const field of schema.inputs) {
    const binding = field.patientBinding;
    const raw = inputs[field.id];
    if (!binding || raw === undefined || raw === '') continue;
    if (binding.kind === 'biologicalSex') {
      if (raw !== 'female' && raw !== 'male' && raw !== 'intersex' && raw !== 'unknown')
        throw new Error('Некорректный биологический пол в данных калькулятора.');
      context['biologicalSex'] = raw;
      if (!next.biologicalSex || next.biologicalSex === 'unknown')
        next = { ...next, biologicalSex: raw };
    } else if (binding.kind === 'birthDate' || binding.kind === 'dateOfBirth') {
      if (
        typeof raw !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(raw) ||
        !Number.isFinite(Date.parse(raw)) ||
        new Date(raw).toISOString().slice(0, 10) !== raw
      )
        throw new Error('Некорректная дата рождения в данных калькулятора.');
      context['birthDate'] = raw;
      if (!next.birthDate) next = { ...next, birthDate: raw };
    } else {
      const value = Number(raw) / (binding.valueMultiplier ?? 1);
      if (!Number.isFinite(value)) throw new Error('Некорректное измерение в данных калькулятора.');
      if (binding.kind === 'ageAtEvent') context['ageYears'] = value;
      else if (binding.metricId && binding.unit)
        measurements.push({
          metricId: binding.metricId,
          unit: binding.unit,
          value,
          inputId: field.id,
        });
    }
  }
  return { profile: next, context, measurements };
}
