/**
 * Dose and checkpoint reminders (DIARY_PLAN D4). A patient's phone stores here only the moments of
 * its next reminders; at each moment the phone gets a push saying «reminder at <moment>», and its
 * worker finds on the phone what is due then. The server never learns what the reminder is for.
 */
import { DIARY_MISSED_AFTER_MS, DIARY_REMINDER_GRACE_MS } from '@localmed/contracts';

import { pushToOwners, type Vapid } from './push';
import type { DiaryStore } from './store';

/** The phone's list replaces the stored one; past moments are not kept. */
export async function replaceReminders(
  store: DiaryStore,
  deviceId: string,
  moments: readonly string[],
  now = Date.now(),
): Promise<number> {
  const keys = [
    ...new Set(
      moments
        .map((moment) => new Date(moment))
        .filter((moment) => moment.getTime() > now)
        .map((moment) => moment.toISOString()),
    ),
  ];
  await store.replaceReminders(deviceId, keys);
  return keys.length;
}

/**
 * Sends the reminders that are due and forgets them. One missed by more than the grace period (the
 * service was down) is dropped instead of arriving late. Returns how many pushes went out.
 */
export async function sendDueReminders(
  store: DiaryStore,
  vapid: Vapid,
  log: (line: string) => void,
  now = Date.now(),
): Promise<number> {
  const due = (await store.takeDueReminders(new Date(now).toISOString())).filter(
    (row) => now - new Date(row.at).getTime() <= DIARY_REMINDER_GRACE_MS,
  );
  await Promise.all(
    due.map((row) =>
      pushToOwners(store, vapid, [`p:${row.device_id}`], { kind: 'reminder', at: row.at }, log, {
        ttl: Math.round(DIARY_REMINDER_GRACE_MS / 1000),
      }),
    ),
  );
  return due.length;
}

/** How long a missed-dose notice waits at the push service for a carer's phone that is off. */
const MISSED_TTL_S = 12 * 3600;
/** Taken moments older than this are not kept (the notice for them is long decided). */
const TAKEN_WINDOW_MS = 24 * 3_600_000;

function future(moments: readonly string[], after: number): string[] {
  return [
    ...new Set(
      moments
        .map((moment) => new Date(moment))
        .filter((moment) => moment.getTime() > after)
        .map((moment) => moment.toISOString()),
    ),
  ];
}

/**
 * The missed-dose checks of a diary with a carer (DIARY25): `open` (from the patient's phone)
 * replaces the open moments not yet due for a notice, `taken` closes moments, `clear` (no carer
 * left) drops the open ones.
 */
export async function replaceDoseChecks(
  store: DiaryStore,
  patientId: string,
  input: { open: readonly string[] | undefined; taken: readonly string[]; clear: boolean },
  now = Date.now(),
): Promise<void> {
  const after = now - DIARY_MISSED_AFTER_MS;
  if (input.open || input.clear) {
    await store.replaceDoseChecks(
      patientId,
      input.clear ? [] : future(input.open ?? [], after),
      new Date(after).toISOString(),
    );
  }
  const taken = future(input.taken, now - TAKEN_WINDOW_MS);
  if (taken.length && !input.clear) await store.markDosesTaken(patientId, taken);
}

/**
 * Tells the carers of each diary about a dose still not marked taken `DIARY_MISSED_AFTER_MS` after
 * its moment, once. One the service could not send within the grace period after that is dropped.
 * Returns how many diaries were told.
 */
export async function sendMissedDoses(
  store: DiaryStore,
  vapid: Vapid,
  log: (line: string) => void,
  now = Date.now(),
): Promise<number> {
  const due = now - DIARY_MISSED_AFTER_MS;
  const missed = await store.takeMissedDoses(
    new Date(due).toISOString(),
    new Date(due - DIARY_REMINDER_GRACE_MS).toISOString(),
  );
  let told = 0;
  for (const row of missed) {
    const carers = (await store.activeDevices(row.patient_id))
      .filter((device) => device.kind === 'carer')
      .map((device) => `p:${device.id}`);
    if (!carers.length) continue;
    await pushToOwners(store, vapid, carers, { kind: 'missed', at: row.at }, log, {
      ttl: MISSED_TTL_S,
    });
    told += 1;
  }
  return told;
}
