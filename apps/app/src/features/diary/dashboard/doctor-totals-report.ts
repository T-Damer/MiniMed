/**
 * Sends the doctor's anonymous totals (`doctorTotals`, ADR-0026 §7) to the service: at most once an
 * hour per doctor and only when the numbers changed. Never blocks the page and never tells the
 * doctor about a failure; the next change of the workspace tries again.
 */
import type { DiaryDoctorTotals } from '@localmed/contracts';

import { diaryDoctor } from '@/features/diary/connected/diary-api';
import { type DoctorSession, doctorApi } from '@/features/diary/connected/doctor-account';
import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { doctorTotals, totalsFingerprint } from '@/features/diary/dashboard/doctor-totals';

export const TOTALS_MIN_INTERVAL_MS = 60 * 60_000;
const STORAGE_PREFIX = 'minimed.diary.totals.v1.';

interface SentRecord {
  readonly fingerprint: string;
  readonly at: number;
}

function readSent(doctorId: string): SentRecord | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + doctorId);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<SentRecord>;
    return typeof value.fingerprint === 'string' && typeof value.at === 'number'
      ? { fingerprint: value.fingerprint, at: value.at }
      : undefined;
  } catch {
    return undefined;
  }
}

function writeSent(doctorId: string, record: SentRecord): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + doctorId, JSON.stringify(record));
  } catch {
    // Storage blocked or full: the totals are simply sent again next time.
  }
}

/** Doctors with a send in flight, so a burst of workspace changes sends once. */
const sending = new Set<string>();

/**
 * Computes and sends the totals when due. Resolves to whether something was sent; never rejects.
 * The cheap hourly check comes first, so the workspace's frequent changes cost nothing.
 */
export async function reportDoctorTotals(
  session: DoctorSession,
  patients: () => readonly DoctorPatient[],
  now: Date = new Date(),
  send: (totals: DiaryDoctorTotals) => Promise<unknown> = (totals) =>
    diaryDoctor.totals(doctorApi(session), totals),
): Promise<boolean> {
  const doctorId = session.doctor.id;
  try {
    if (sending.has(doctorId)) return false;
    const last = readSent(doctorId);
    if (last && now.getTime() - last.at < TOTALS_MIN_INTERVAL_MS && now.getTime() >= last.at) {
      return false;
    }
    const totals = doctorTotals(patients(), session, now);
    if (!totals) return false;
    const fingerprint = totalsFingerprint(totals);
    if (last?.fingerprint === fingerprint) return false;
    sending.add(doctorId);
    try {
      await send(totals);
      writeSent(doctorId, { fingerprint, at: now.getTime() });
      return true;
    } finally {
      sending.delete(doctorId);
    }
  } catch {
    return false;
  }
}
