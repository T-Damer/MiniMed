import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { lastPatientEntry } from '@/features/diary/dashboard/patient-order';

/**
 * The list's search, the counters in the header and the colleague marks (owner 2026-11-03). Pure:
 * the dashboard only renders them.
 */

/** The header counters; each one also filters the list. */
export type PatientFilter = 'urgent' | 'today' | 'silent';

/** «Давно нет»: no entry from the patient for this long. */
export const SILENT_AFTER_MS = 2 * 24 * 3_600_000;

/** Lower case, «ё» as «е», single spaces: what the search compares. */
export function normalizeSearch(text: string): string {
  return text.toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

export function patientLabel(patient: DoctorPatient): string {
  return patient.replica.profile?.label ?? '';
}

/** Every word typed is somewhere in the patient's label (so «мед дем» finds «Демо · Медведь»). */
export function matchesQuery(patient: DoctorPatient, query: string): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const label = normalizeSearch(patientLabel(patient));
  return words.every((word) => label.includes(word));
}

function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** The patient wrote something since this morning. */
export function wroteToday(patient: DoctorPatient, now: Date): boolean {
  const last = lastPatientEntry(patient);
  return last !== '' && Date.parse(last) >= startOfDay(now);
}

/** A running diary that has had no entry from the patient for two days (or never). */
export function silentFor2Days(patient: DoctorPatient, now: Date): boolean {
  if (patient.summary.status !== 'active' || !patient.replica.invitation) return false;
  const last = lastPatientEntry(patient);
  if (last === '') return true;
  return now.getTime() - Date.parse(last) > SILENT_AFTER_MS;
}

export function matchesFilter(
  patient: DoctorPatient,
  filter: PatientFilter | undefined,
  now: Date,
): boolean {
  switch (filter) {
    case undefined:
      return true;
    case 'urgent':
      return patient.summary.openAlerts > 0;
    case 'today':
      return wroteToday(patient, now);
    case 'silent':
      return silentFor2Days(patient, now);
  }
}

export interface PatientCounters {
  readonly urgent: number;
  readonly today: number;
  readonly silent: number;
}

export function patientCounters(patients: readonly DoctorPatient[], now: Date): PatientCounters {
  let urgent = 0;
  let today = 0;
  let silent = 0;
  for (const patient of patients) {
    if (patient.summary.openAlerts > 0) urgent += 1;
    if (wroteToday(patient, now)) today += 1;
    if (silentFor2Days(patient, now)) silent += 1;
  }
  return { urgent, today, silent };
}

/** The latest plan version a doctor other than `doctorId` saved, or undefined. */
export function latestColleagueEdit(
  patient: DoctorPatient,
  doctorId: string,
): { readonly author: string; readonly at: string } | undefined {
  const history = patient.replica.planHistory ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const revision = history[index];
    if (revision && revision.author.startsWith('d:') && revision.author !== `d:${doctorId}`) {
      return { author: revision.author.slice(2), at: revision.at };
    }
  }
  return undefined;
}

/**
 * Whether a colleague changed the plan after the doctor last looked at this patient. A patient
 * the doctor has not looked at yet (`seenAt` unknown) is not marked: there is nothing to compare.
 */
export function changedByColleague(
  patient: DoctorPatient,
  doctorId: string,
  seenAt: string | undefined,
): { readonly author: string; readonly at: string } | undefined {
  if (seenAt === undefined) return undefined;
  const edit = latestColleagueEdit(patient, doctorId);
  return edit && edit.at > seenAt ? edit : undefined;
}

/** Doctor ids known from the replica alone (no request): plan authors, entry authors and the owner. */
export function knownDoctorIds(patient: DoctorPatient): readonly string[] {
  const ids = new Set<string>([patient.summary.ownerId]);
  for (const revision of patient.replica.planHistory ?? []) {
    if (revision.author.startsWith('d:')) ids.add(revision.author.slice(2));
  }
  for (const author of patient.replica.entryAuthors.values()) {
    if (author.startsWith('d:')) ids.add(author.slice(2));
  }
  return [...ids];
}
