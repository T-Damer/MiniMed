/**
 * Dose and checkpoint reminders (DIARY_PLAN D4). A patient's phone stores here only the moments of
 * its next reminders; at each moment the phone gets a push saying «reminder at <moment>», and its
 * worker finds on the phone what is due then. The server never learns what the reminder is for.
 */
import type { Database } from 'bun:sqlite';
import { DIARY_REMINDER_GRACE_MS } from '@localmed/contracts';

import { pushToOwners, type Vapid } from './push';

/** The phone's list replaces the stored one; past moments are not kept. */
export function replaceReminders(
  db: Database,
  deviceId: string,
  moments: readonly string[],
  now = Date.now(),
): number {
  const keys = [
    ...new Set(
      moments
        .map((moment) => new Date(moment))
        .filter((moment) => moment.getTime() > now)
        .map((moment) => moment.toISOString()),
    ),
  ];
  db.transaction(() => {
    db.query('DELETE FROM reminders WHERE device_id = ?').run(deviceId);
    const insert = db.query('INSERT INTO reminders (device_id, at) VALUES (?, ?)');
    for (const at of keys) insert.run(deviceId, at);
  })();
  return keys.length;
}

/**
 * Sends the reminders that are due and forgets them. One missed by more than the grace period (the
 * service was down) is dropped instead of arriving late. Returns how many pushes went out.
 */
export function sendDueReminders(
  db: Database,
  vapid: Vapid,
  log: (line: string) => void,
  now = Date.now(),
): number {
  const due = db
    .query<{ device_id: string; at: string }, [string]>(
      `SELECT r.device_id, r.at FROM reminders r
       JOIN devices d ON d.id = r.device_id AND d.revoked_at IS NULL
       WHERE r.at <= ? ORDER BY r.at`,
    )
    .all(new Date(now).toISOString());
  db.query('DELETE FROM reminders WHERE at <= ?').run(new Date(now).toISOString());
  let sent = 0;
  for (const row of due) {
    if (now - new Date(row.at).getTime() > DIARY_REMINDER_GRACE_MS) continue;
    pushToOwners(db, vapid, [`p:${row.device_id}`], { kind: 'reminder', at: row.at }, log, {
      ttl: Math.round(DIARY_REMINDER_GRACE_MS / 1000),
    });
    sent += 1;
  }
  return sent;
}
