import type { CalculatorSchema } from '@localmed/contracts';
import type { PatientProfile } from '@/state/patient-domain';

/**
 * Capture only schema-declared patient fields; age never becomes an invented birth date. `outputs`
 * are the values the result found for steps bound to a card field (the due date), by context key.
 */
export function capturePatientCalculatorInputs(
  profile: PatientProfile,
  schema: CalculatorSchema,
  inputs: Readonly<Record<string, string | number>>,
  outputs: Readonly<Record<string, string | number>> = {},
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
    } else if (binding.kind === 'profileContext') {
      // A named card field (the last menstrual period, say): the entered value is the card's
      // current one, so a changed value replaces the stored one and the event keeps what was used.
      if (!binding.contextKey) continue;
      if (typeof raw === 'number' && !Number.isFinite(raw))
        throw new Error('Некорректное значение в данных калькулятора.');
      context[binding.contextKey] = raw;
      if (next.context?.[binding.contextKey] !== raw)
        next = { ...next, context: { ...next.context, [binding.contextKey]: raw } };
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
  for (const step of schema.steps) {
    const key = step.patientBinding?.contextKey;
    const found = key === undefined ? undefined : outputs[key];
    if (key === undefined || found === undefined) continue;
    if (typeof found === 'number' && !Number.isFinite(found))
      throw new Error('Некорректное значение в данных калькулятора.');
    context[key] = found;
    if (next.context?.[key] !== found)
      next = { ...next, context: { ...next.context, [key]: found } };
  }
  return { profile: next, context, measurements };
}
