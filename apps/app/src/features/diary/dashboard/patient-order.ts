import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';

/**
 * How the doctor's patient list is ordered (owner 2026-10-28): by the patient's latest entry, by
 * the doctor's latest plan change, or by name. Urgent marks stay on top in every order.
 */
export type PatientOrder = 'patient' | 'doctor' | 'name';

export const PATIENT_ORDER_LABEL: Readonly<Record<PatientOrder, string>> = {
  patient: 'Пациент',
  doctor: 'Врач',
  name: 'А–Я',
};

/** The latest entry the patient wrote (doctor corrections do not count), ISO or ''. */
export function lastPatientEntry(patient: DoctorPatient): string {
  let latest = '';
  for (const entry of patient.replica.entries.values()) {
    if (patient.replica.entryAuthors.get(entry.id)?.startsWith('d:')) continue;
    if (entry.at > latest) latest = entry.at;
  }
  return latest;
}

function name(patient: DoctorPatient): string {
  return patient.replica.profile?.label ?? '';
}

export function orderPatients(
  patients: readonly DoctorPatient[],
  order: PatientOrder,
): DoctorPatient[] {
  const key = (patient: DoctorPatient): string =>
    order === 'patient'
      ? lastPatientEntry(patient)
      : order === 'doctor'
        ? (patient.replica.invitation?.issuedAt ?? patient.summary.createdAt)
        : '';
  return patients.toSorted((left, right) => {
    if (left.summary.openAlerts !== right.summary.openAlerts) {
      return right.summary.openAlerts - left.summary.openAlerts;
    }
    if (order === 'name') return name(left).localeCompare(name(right), 'ru');
    return key(right).localeCompare(key(left)) || name(left).localeCompare(name(right), 'ru');
  });
}
