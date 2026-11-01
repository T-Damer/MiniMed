/**
 * Dose and checkpoint reminders (DIARY_PLAN D4). A patient's phone stores here only the moments of
 * its next reminders; at each moment the phone gets a push saying «reminder at <moment>», and its
 * worker finds on the phone what is due then. The server never learns what the reminder is for.
 */
import { DIARY_REMINDER_GRACE_MS } from '@localmed/contracts';

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
