/**
 * The service owner's overview (`GET /api/admin/stats`) built from the store's aggregates. Pure:
 * the store hands over counts and times only (`ServiceStatsRaw`), so nothing here can read a
 * record body, and no patient id leaves this function (ADR-0026 §7).
 */
import { DIARY_ADMIN_WEEKS, type DiaryAdminStats } from '@localmed/contracts';

import type { ServiceStatsRaw } from './store';

const DAY_MS = 86_400_000;

/** The Monday (UTC) of the week of `time`, as `YYYY-MM-DD`. */
export function weekStart(time: Date): string {
  const day = (time.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate());
  return new Date(midnight - day * DAY_MS).toISOString().slice(0, 10);
}

/** The ISO times `serviceStats` needs: 7 and 30 days before `now`. */
export function statsWindows(now: Date): { since7: string; since30: string } {
  return {
    since7: new Date(now.getTime() - 7 * DAY_MS).toISOString(),
    since30: new Date(now.getTime() - 30 * DAY_MS).toISOString(),
  };
}

export function buildServiceStats(raw: ServiceStatsRaw, now: Date): DiaryAdminStats {
  const { since7, since30 } = statsWindows(now);
  const live = raw.patients.filter((patient) => patient.status !== 'withdrawn');
  const liveIds = new Set(live.map((patient) => patient.id));
  const recordsOf = new Map(raw.records.map((row) => [row.patient_id, row]));
  const devicesOf = new Map(raw.devices.map((row) => [row.patient_id, row]));

  const recent = (days: 7 | 30, row: ServiceStatsRaw['records'][number] | undefined): boolean =>
    (row?.[days === 7 ? 'last7' : 'last30'] ?? 0) > 0;

  // Weeks, oldest first, ending with the current one.
  const weeks = Array.from({ length: DIARY_ADMIN_WEEKS }, (_, index) => ({
    start: weekStart(new Date(now.getTime() - (DIARY_ADMIN_WEEKS - 1 - index) * 7 * DAY_MS)),
    newDoctors: 0,
    newPatients: 0,
  }));
  const bump = (createdAt: string, key: 'newDoctors' | 'newPatients'): void => {
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return;
    const week = weeks.find((entry) => entry.start === weekStart(created));
    if (week) week[key] += 1;
  };
  for (const doctor of raw.doctors) bump(doctor.created_at, 'newDoctors');
  for (const patient of live) bump(patient.created_at, 'newPatients');

  const patientsOfDoctor = new Map<string, string[]>();
  for (const member of raw.members) {
    if (!liveIds.has(member.patient_id)) continue;
    const list = patientsOfDoctor.get(member.doctor_id) ?? [];
    list.push(member.patient_id);
    patientsOfDoctor.set(member.doctor_id, list);
  }

  const totalsOf = new Map(raw.totals.map((row) => [row.doctor_id, row]));

  const doctorRows = raw.doctors
    .map((doctor) => {
      const ids = patientsOfDoctor.get(doctor.id) ?? [];
      let lastActivityAt: string | null = null;
      let activePatients = 0;
      for (const id of ids) {
        const row = recordsOf.get(id);
        if (recent(7, row)) activePatients += 1;
        if (row?.last_at && (!lastActivityAt || row.last_at > lastActivityAt)) {
          lastActivityAt = row.last_at;
        }
      }
      const totals = totalsOf.get(doctor.id);
      return {
        name: doctor.name,
        email: doctor.email,
        patients: ids.length,
        activePatients,
        lastActivityAt,
        prescriptions: totals?.prescriptions ?? null,
        adherence30: totals && totals.total30 > 0 ? totals.done30 / totals.total30 : null,
        totalsAt: totals?.at ?? null,
      };
    })
    .sort(
      (a, b) =>
        (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') || b.patients - a.patients,
    );

  let records = { total: 0, last7: 0, last30: 0 };
  for (const row of raw.records) {
    records = {
      total: records.total + row.total,
      last7: records.last7 + row.last7,
      last30: records.last30 + row.last30,
    };
  }
  // Reports of doctors who no longer exist are not counted; old ones still are.
  const reported = raw.totals.filter((row) =>
    raw.doctors.some((doctor) => doctor.id === row.doctor_id),
  );
  const sum = (pick: (row: (typeof reported)[number]) => number): number =>
    reported.reduce((total, row) => total + pick(row), 0);
  let phones = { patient: 0, carer: 0 };
  for (const row of raw.devices) {
    phones = { patient: phones.patient + row.phones, carer: phones.carer + row.carers };
  }

  return {
    generatedAt: now.toISOString(),
    doctors: {
      total: raw.doctors.length,
      withPatients: [...patientsOfDoctor.values()].filter((ids) => ids.length > 0).length,
      new7: raw.doctors.filter((doctor) => doctor.created_at >= since7).length,
      new30: raw.doctors.filter((doctor) => doctor.created_at >= since30).length,
    },
    patients: {
      total: live.length,
      withdrawn: raw.patients.length - live.length,
      withPhone: live.filter((patient) => (devicesOf.get(patient.id)?.phones ?? 0) > 0).length,
      withCarer: live.filter((patient) => (devicesOf.get(patient.id)?.carers ?? 0) > 0).length,
      active7: live.filter((patient) => recent(7, recordsOf.get(patient.id))).length,
      active30: live.filter((patient) => recent(30, recordsOf.get(patient.id))).length,
      new7: live.filter((patient) => patient.created_at >= since7).length,
      new30: live.filter((patient) => patient.created_at >= since30).length,
    },
    phones,
    records,
    alerts: raw.alerts,
    diariesWithPlan: sum((row) => row.diaries),
    prescriptions: sum((row) => row.prescriptions),
    adherence7: { done: sum((row) => row.done7), total: sum((row) => row.total7) },
    adherence30: { done: sum((row) => row.done30), total: sum((row) => row.total30) },
    weeks,
    doctorRows,
  };
}
