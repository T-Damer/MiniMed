/**
 * Local device profile of the clinician and their organisation. It is filled into official forms
 * (certificates, sanatorium cards). It is not patient data, so it lives in localStorage on this
 * device and never in the patient vault.
 */
export interface ClinicianProfile {
  readonly organizationName?: string;
  readonly organizationAddress?: string;
  /** ОГРН (13 digits) or ОГРНИП (15 digits). */
  readonly ogrn?: string;
  readonly clinicianFullName?: string;
  readonly clinicianPosition?: string;
}

export type ClinicianProfileKey = keyof ClinicianProfile;

/** A patch: a key set to `undefined` or an empty string removes that field. */
export type ClinicianProfilePatch = {
  readonly [Key in ClinicianProfileKey]?: string | undefined;
};

export const CLINICIAN_PROFILE_KEY = 'minimed.clinician-profile.v1';
export const CLINICIAN_PROFILE_EVENT = 'minimed:clinician-profile';

const CLINICIAN_PROFILE_KEYS: readonly ClinicianProfileKey[] = [
  'organizationName',
  'organizationAddress',
  'ogrn',
  'clinicianFullName',
  'clinicianPosition',
];

/**
 * Validates an ОГРН (13 digits) or ОГРНИП (15 digits) including the control digit. Returns a
 * Russian error message, or `undefined` for an empty or valid value.
 */
export function validateOgrn(value: string | undefined): string | undefined {
  const text = (value ?? '').trim();
  if (!text) return undefined;
  if (!/^\d+$/u.test(text)) return 'ОГРН состоит только из цифр.';
  if (text.length !== 13 && text.length !== 15) {
    return 'ОГРН содержит 13 цифр, ОГРНИП — 15.';
  }
  const body = BigInt(text.slice(0, -1));
  const divisor = text.length === 13 ? 11n : 13n;
  const control = (body % divisor) % 10n;
  if (control !== BigInt(text.slice(-1))) return 'Контрольная цифра ОГРН не сходится.';
  return undefined;
}

/**
 * Keeps known keys only, trims strings and drops empty ones. A stored ОГРН that fails validation
 * is dropped as well, so the profile never carries a number a form could not rely on.
 */
export function normalizeClinicianProfile(value: unknown): ClinicianProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Partial<Record<ClinicianProfileKey, string>> = {};
  for (const key of CLINICIAN_PROFILE_KEYS) {
    const candidate = record[key];
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (key === 'ogrn' && validateOgrn(trimmed) !== undefined) continue;
    result[key] = trimmed;
  }
  return result;
}

export function getClinicianProfile(): ClinicianProfile {
  try {
    const raw = window.localStorage.getItem(CLINICIAN_PROFILE_KEY);
    return raw ? normalizeClinicianProfile(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/**
 * Merges a patch into the stored profile. Throws a Russian error when the patched ОГРН is invalid
 * (nothing is written then); storage failures degrade silently to the in-memory result.
 */
export function setClinicianProfile(patch: ClinicianProfilePatch): ClinicianProfile {
  const error = validateOgrn(patch.ogrn);
  if (error) throw new Error(error);
  const merged: Record<string, unknown> = { ...getClinicianProfile() };
  for (const key of CLINICIAN_PROFILE_KEYS) {
    if (key in patch) merged[key] = patch[key];
  }
  const next = normalizeClinicianProfile(merged);
  try {
    window.localStorage.setItem(CLINICIAN_PROFILE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private window, quota); the caller still gets the profile.
  }
  try {
    window.dispatchEvent(
      new CustomEvent<ClinicianProfile>(CLINICIAN_PROFILE_EVENT, { detail: next }),
    );
  } catch {
    // Non-browser environments have no event target to notify.
  }
  return next;
}

export function subscribeClinicianProfile(
  listener: (profile: ClinicianProfile) => void,
): () => void {
  const onChange = (event: Event): void => {
    const detail = (event as CustomEvent<ClinicianProfile | undefined>).detail;
    listener(detail ?? getClinicianProfile());
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || event.key === CLINICIAN_PROFILE_KEY) listener(getClinicianProfile());
  };
  window.addEventListener(CLINICIAN_PROFILE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CLINICIAN_PROFILE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
