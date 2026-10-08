import { type BiologicalSex, PATIENT_METRIC_REGISTRY } from '@/state/patient-domain';

const SEX_LABELS: Readonly<Record<BiologicalSex, string>> = {
  female: 'Женский',
  male: 'Мужской',
  intersex: 'Интерсекс',
  unknown: 'Неизвестно',
};

/** The Russian label of a stored biological sex; nothing for an unset value. */
export function patientSexLabel(sex: BiologicalSex | undefined): string | undefined {
  return sex ? SEX_LABELS[sex] : undefined;
}

/** The chart group that joins systolic and diastolic pressure has no registry entry of its own. */
const BLOOD_PRESSURE_GROUP = 'blood-pressure';

/** The registry name of a metric («body-mass» → «Масса тела»); a custom series keeps the user's own id. */
export function patientMetricLabel(metricId: string): string {
  if (metricId === BLOOD_PRESSURE_GROUP) return 'Артериальное давление';
  return (
    PATIENT_METRIC_REGISTRY.find((definition) => definition.metricId === metricId)?.label ??
    metricId
  );
}
