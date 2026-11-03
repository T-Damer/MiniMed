import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';

/**
 * The doctors who curate a patient, for the little avatars on the list's rows. A doctor's initials
 * and colour come from the name (the e-mail when there is no name), so the same doctor looks the
 * same on every row and on every device.
 */
export interface Curator {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  /** 0–359, for the avatar's colour. */
  readonly hue: number;
  readonly owner: boolean;
}

/** Two letters: the first of the first two words of a name, or of an e-mail's local part. */
export function curatorInitials(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0] || '';
  const words = source.split(/[\s._-]+/u).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  return letters.join('').toLocaleUpperCase('ru') || '?';
}

/** A stable hue from any text (FNV-1a, folded to a colour wheel). */
export function curatorHue(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
}

const TTL_MS = 5 * 60_000;
const MAX_PARALLEL = 2;

interface Cached {
  readonly at: number;
  readonly curators: Promise<readonly Curator[]>;
}

const cache = new Map<string, Cached>();
const waiting: (() => void)[] = [];
let running = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = (): void => {
      running += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          waiting.shift()?.();
        });
    };
    if (running < MAX_PARALLEL) start();
    else waiting.push(start);
  });
}

/**
 * The patient's active curators, owner first. One request per patient, kept for a few minutes and
 * shared by every row and every render; at most two requests run at a time, so a long list does
 * not open a burst of connections. A failed request is forgotten: the next look tries again.
 */
export function loadCurators(
  workspace: DoctorDiaries,
  patientId: string,
): Promise<readonly Curator[]> {
  const key = `${workspace.doctorId}:${patientId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.curators;
  const curators = schedule(() => workspace.detail(patientId)).then((detail) =>
    detail.members
      .filter((member) => member.status === 'active')
      .map(
        (member): Curator => ({
          id: member.doctor.id,
          name: member.doctor.name || member.doctor.email,
          initials: curatorInitials(member.doctor.name, member.doctor.email),
          hue: curatorHue(member.doctor.name || member.doctor.email),
          owner: member.role === 'owner',
        }),
      )
      .toSorted((left, right) => Number(right.owner) - Number(left.owner)),
  );
  cache.set(key, { at: Date.now(), curators });
  curators.catch(() => {
    if (cache.get(key)?.curators === curators) cache.delete(key);
  });
  return curators;
}

/** Forgets what was read for this patient (members changed). */
export function forgetCurators(patientId?: string): void {
  if (patientId === undefined) cache.clear();
  else for (const key of [...cache.keys()]) if (key.endsWith(`:${patientId}`)) cache.delete(key);
}
