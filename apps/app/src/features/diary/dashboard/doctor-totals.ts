/**
 * The anonymous per-doctor totals the doctor's app sends to the service (ADR-0026 §7): how many of
 * the doctor's own diaries have a plan, how many prescriptions are active and how many planned
 * intakes were marked over 7 and 30 days. Summed over all the doctor's diaries; nothing per
 * patient leaves this function, no ids, no names.
 */
import type { DiaryDoctorTotals } from '@localmed/contracts';
import { replicaResults } from '@/features/diary/connected/diary-replica';
import type { DoctorSession } from '@/features/diary/connected/doctor-account';
import { isDemoSession } from '@/features/diary/connected/doctor-account';
import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { DEMO_LABEL_PREFIX } from '@/features/diary/dashboard/demo-patients';
import { adherence } from '@/features/diary/dashboard/diary-insights';
import { activePlanItems } from '@/features/diary/diary-model';

/**
 * The totals over the diaries where this doctor is the owner (a patient with several curators is
 * counted once, by the owner's app). Demo diaries and demo sessions report nothing: undefined.
 * A diary counts when it has at least one active plan item.
 */
export function doctorTotals(
  patients: readonly DoctorPatient[],
  session: Pick<DoctorSession, 'doctor'>,
  now: Date,
): DiaryDoctorTotals | undefined {
  if (isDemoSession(session)) return undefined;
  const totals = {
    diaries: 0,
    prescriptions: 0,
    adherence7: { done: 0, total: 0 },
    adherence30: { done: 0, total: 0 },
  };
  for (const patient of patients) {
    if (patient.summary.role !== 'owner' || patient.summary.status === 'withdrawn') continue;
    if (patient.replica.profile?.label?.startsWith(DEMO_LABEL_PREFIX)) continue;
    const results = replicaResults(patient.replica);
    if (!results) continue;
    const prescriptions = activePlanItems(results.invitation).length;
    if (prescriptions === 0) continue;
    totals.diaries += 1;
    totals.prescriptions += prescriptions;
    for (const [days, sum] of [
      [7, totals.adherence7],
      [30, totals.adherence30],
    ] as const) {
      const { done, total } = adherence(results.invitation, results.entries, days, now);
      sum.done += done;
      sum.total += total;
    }
  }
  return totals;
}

/** Same numbers, same text: what the upload compares to know whether anything changed. */
export function totalsFingerprint(totals: DiaryDoctorTotals): string {
  return [
    totals.diaries,
    totals.prescriptions,
    totals.adherence7.done,
    totals.adherence7.total,
    totals.adherence30.done,
    totals.adherence30.total,
  ].join('/');
}
