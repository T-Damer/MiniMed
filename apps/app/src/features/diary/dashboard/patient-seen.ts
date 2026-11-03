/**
 * When this doctor last looked at each patient, on this device: the colleague mark on the list
 * compares plan changes with it. A patient seen for the first time is stamped with the moment of
 * the first sight, so only what changes afterwards is marked.
 */
const KEY = 'minimed.diary.patient-seen.v1';

type Seen = Record<string, string>;

function read(): Seen {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null) return {};
    const seen: Seen = {};
    for (const [id, at] of Object.entries(parsed)) if (typeof at === 'string') seen[id] = at;
    return seen;
  } catch (cause) {
    console.warn('Отметки «просмотрено» не прочитаны', cause);
    return {};
  }
}

function write(seen: Seen): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(seen));
  } catch (cause) {
    console.warn('Отметки «просмотрено» не сохранены', cause);
  }
}

const scoped = (doctorId: string, patientId: string): string => `${doctorId}:${patientId}`;

export function seenAt(doctorId: string, patientId: string): string | undefined {
  return read()[scoped(doctorId, patientId)];
}

/** Stamps the patients not seen before with now; returns the stamps for all of `patientIds`. */
export function stampFirstSight(
  doctorId: string,
  patientIds: readonly string[],
  now: string = new Date().toISOString(),
): ReadonlyMap<string, string> {
  const seen = read();
  let changed = false;
  const result = new Map<string, string>();
  for (const id of patientIds) {
    const key = scoped(doctorId, id);
    const at = seen[key] ?? now;
    if (seen[key] === undefined) {
      seen[key] = now;
      changed = true;
    }
    result.set(id, at);
  }
  if (changed) write(seen);
  return result;
}

/** The doctor opened this patient: everything up to now has been seen. */
export function markSeen(
  doctorId: string,
  patientId: string,
  now: string = new Date().toISOString(),
): void {
  const seen = read();
  seen[scoped(doctorId, patientId)] = now;
  write(seen);
}
