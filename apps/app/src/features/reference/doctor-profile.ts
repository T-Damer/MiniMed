/**
 * The doctor's specialty interests, inferred on this device and never sent anywhere.
 *
 * A word such as «депрессия» means different things in psychiatry and in traumatology. The
 * dictionary orders the senses by how common they are overall; this profile adds a small push
 * towards the fields the doctor actually reads and searches in. It is a bag of decayed weights
 * per medical field (`MEDICAL_FIELDS` ids), fed by explicit actions — opening a sense of a term,
 * choosing a specialty section, opening a recommendation of a field — and nothing else. It can
 * be reset at any time and is empty until the doctor does something.
 */
export interface DoctorProfile {
  readonly version: 1;
  /** Decayed interaction weight per field id. */
  readonly fields: Readonly<Record<string, number>>;
}

export const DOCTOR_PROFILE_KEY = 'minimed.doctor-profile.v1';
export const DOCTOR_PROFILE_EVENT = 'minimed:doctor-profile';

/** Every new signal first fades older ones, so interests follow the doctor's recent work. */
export const PROFILE_DECAY = 0.97;
/** Total weight at which the profile is trusted fully. Below it the boost shrinks linearly. */
export const PROFILE_FULL_CONFIDENCE = 6;
export const MAX_PROFILE_FIELDS = 40;

export const EMPTY_DOCTOR_PROFILE: DoctorProfile = { version: 1, fields: {} };

const FIELD_ID = /^[a-z][a-z-]{1,39}$/u;

export function normalizeDoctorProfile(value: unknown): DoctorProfile {
  if (typeof value !== 'object' || value === null) return EMPTY_DOCTOR_PROFILE;
  const raw = (value as { readonly fields?: unknown }).fields;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_DOCTOR_PROFILE;
  const fields: Record<string, number> = {};
  for (const [id, weight] of Object.entries(raw)) {
    if (!FIELD_ID.test(id) || typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0)
      continue;
    fields[id] = weight;
    if (Object.keys(fields).length >= MAX_PROFILE_FIELDS) break;
  }
  return { version: 1, fields };
}

/** A new profile with one signal for `field` (weight 1 by default). Pure. */
export function withSignal(profile: DoctorProfile, field: string, weight = 1): DoctorProfile {
  if (!FIELD_ID.test(field) || !(weight > 0)) return profile;
  const fields: Record<string, number> = {};
  for (const [id, value] of Object.entries(profile.fields)) {
    const faded = value * PROFILE_DECAY;
    if (faded >= 0.01) fields[id] = faded;
  }
  fields[field] = (fields[field] ?? 0) + weight;
  const kept = Object.entries(fields)
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, MAX_PROFILE_FIELDS);
  return { version: 1, fields: Object.fromEntries(kept) };
}

/**
 * How strongly the profile points at `field`, 0…1: the field's share of all weight, scaled by
 * how much evidence there is, so one stray tap never decides a sense.
 */
export function profileInterest(profile: DoctorProfile, field: string | undefined): number {
  if (!field) return 0;
  const total = Object.values(profile.fields).reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 0;
  const share = (profile.fields[field] ?? 0) / total;
  return share * Math.min(1, total / PROFILE_FULL_CONFIDENCE);
}

/** The field the doctor reads most, once there is any evidence. */
export function leadingField(profile: DoctorProfile): string | undefined {
  const [best] = Object.entries(profile.fields).toSorted((left, right) => right[1] - left[1]);
  return best?.[0];
}

export function getDoctorProfile(): DoctorProfile {
  try {
    const raw = window.localStorage.getItem(DOCTOR_PROFILE_KEY);
    return raw ? normalizeDoctorProfile(JSON.parse(raw)) : EMPTY_DOCTOR_PROFILE;
  } catch {
    return EMPTY_DOCTOR_PROFILE;
  }
}

function store(profile: DoctorProfile): DoctorProfile {
  try {
    if (Object.keys(profile.fields).length === 0)
      window.localStorage.removeItem(DOCTOR_PROFILE_KEY);
    else window.localStorage.setItem(DOCTOR_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode or a full quota: the profile simply stays what it was.
    return getDoctorProfile();
  }
  window.dispatchEvent(new CustomEvent<DoctorProfile>(DOCTOR_PROFILE_EVENT, { detail: profile }));
  return profile;
}

/** Records one interaction with a field (a sense opened, a specialty section chosen). */
export function noteDoctorField(field: string, weight = 1): DoctorProfile {
  return store(withSignal(getDoctorProfile(), field, weight));
}

/** Forgets everything the profile learned. */
export function resetDoctorProfile(): DoctorProfile {
  return store(EMPTY_DOCTOR_PROFILE);
}

export function subscribeDoctorProfile(listener: (profile: DoctorProfile) => void): () => void {
  const handle = (event: Event): void =>
    listener((event as CustomEvent<DoctorProfile | undefined>).detail ?? getDoctorProfile());
  window.addEventListener(DOCTOR_PROFILE_EVENT, handle);
  return () => window.removeEventListener(DOCTOR_PROFILE_EVENT, handle);
}
