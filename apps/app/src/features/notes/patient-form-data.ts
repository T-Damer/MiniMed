import {
  type EpisodeDiagnosis,
  normalizeIcd10Code,
  normalizeSnils,
  PATIENT_ADDRESS_FIELDS,
  type PatientAddress,
  type PatientProfile,
  type PatientProfileDataPatch,
  type PatientVaultSnapshot,
  setEpisodeDiagnosis,
  updatePatientProfileData,
} from '@/state/patient-domain';

/** Flat, string-only editing state for the form-data panel. */
export interface PatientFormDraft {
  readonly fullName: string;
  readonly snils: string;
  readonly omsNumber: string;
  readonly omsIssuedAt: string;
  readonly omsInsurer: string;
  readonly workplace: string;
  readonly citizenship: string;
  readonly address: Readonly<Record<keyof PatientAddress, string>>;
  readonly stayAddress: Readonly<Record<keyof PatientAddress, string>>;
}

export interface PatientFormDraftErrors {
  readonly snils?: string;
  readonly omsNumber?: string;
}

function addressDraft(address: PatientAddress | undefined): Record<keyof PatientAddress, string> {
  const draft = {} as Record<keyof PatientAddress, string>;
  for (const field of PATIENT_ADDRESS_FIELDS) draft[field.key] = address?.[field.key] ?? '';
  return draft;
}

export function profileToDraft(profile: PatientProfile): PatientFormDraft {
  return {
    fullName: profile.fullName ?? '',
    snils: profile.snils ?? '',
    omsNumber: profile.omsPolicy?.number ?? '',
    omsIssuedAt: profile.omsPolicy?.issuedAt?.slice(0, 10) ?? '',
    omsInsurer: profile.omsPolicy?.insurer ?? '',
    workplace: profile.workplace ?? '',
    citizenship: profile.citizenship ?? '',
    address: addressDraft(profile.address),
    stayAddress: addressDraft(profile.stayAddress),
  };
}

export function draftsEqual(left: PatientFormDraft, right: PatientFormDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Некорректное значение.';
}

/**
 * Converts the editing state to a patch (empty fields remove stored values) plus inline errors.
 * Light validation only: SNILS shape and "policy dates need a policy number". A field group with an
 * error is left out of the patch, so the stored value stays until the typed one is valid, while
 * every other field is saved as typed: validation never blocks a draft.
 */
export function draftToPatch(draft: PatientFormDraft): {
  readonly patch: PatientProfileDataPatch;
  readonly errors: PatientFormDraftErrors;
} {
  let snils: string | undefined;
  let snilsError: string | undefined;
  try {
    snils = normalizeSnils(draft.snils);
  } catch (cause) {
    snilsError = messageOf(cause);
  }
  const omsNumber = draft.omsNumber.trim();
  const omsIssuedAt = draft.omsIssuedAt.trim();
  const omsInsurer = draft.omsInsurer.trim();
  const omsError =
    !omsNumber && (omsIssuedAt || omsInsurer)
      ? 'Укажите номер полиса или очистите остальные поля полиса.'
      : undefined;
  return {
    patch: {
      fullName: draft.fullName,
      ...(snilsError ? {} : { snils }),
      ...(omsError
        ? {}
        : {
            omsPolicy: omsNumber
              ? {
                  number: omsNumber,
                  ...(omsIssuedAt ? { issuedAt: omsIssuedAt } : {}),
                  ...(omsInsurer ? { insurer: omsInsurer } : {}),
                }
              : undefined,
          }),
      workplace: draft.workplace,
      citizenship: draft.citizenship,
      address: { ...draft.address },
      stayAddress: { ...draft.stayAddress },
    },
    errors: {
      ...(snilsError ? { snils: snilsError } : {}),
      ...(omsError ? { omsNumber: omsError } : {}),
    },
  };
}

/**
 * Applies a typed draft to the stored profile (the valid part, see {@link draftToPatch}). A draft
 * that changes nothing returns the snapshot itself, so no write and no new modification time.
 */
export function applyFormDraft(
  snapshot: PatientVaultSnapshot,
  patientId: string,
  draft: PatientFormDraft,
): { readonly snapshot: PatientVaultSnapshot; readonly errors: PatientFormDraftErrors } {
  const { patch, errors } = draftToPatch(draft);
  const target = snapshot.profiles.find((profile) => profile.id === patientId);
  if (!target) throw new Error('Пациент не найден.');
  const probe = updatePatientProfileData(snapshot, patientId, patch, target.updatedAt);
  const probed = probe.profiles.find((profile) => profile.id === patientId);
  if (probed && draftsEqual(profileToDraft(probed), profileToDraft(target))) {
    return { snapshot, errors };
  }
  return { snapshot: updatePatientProfileData(snapshot, patientId, patch), errors };
}

/** The draft as sealed text for its write-ahead copy. */
export function serializeFormDraft(draft: PatientFormDraft): string {
  return JSON.stringify(draft);
}

const SCALAR_DRAFT_KEYS = [
  'fullName',
  'snils',
  'omsNumber',
  'omsIssuedAt',
  'omsInsurer',
  'workplace',
  'citizenship',
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addressFromDraft(value: unknown): Record<keyof PatientAddress, string> | undefined {
  if (!isObject(value)) return undefined;
  const draft = {} as Record<keyof PatientAddress, string>;
  for (const field of PATIENT_ADDRESS_FIELDS) {
    const part = value[field.key];
    if (typeof part !== 'string') return undefined;
    draft[field.key] = part;
  }
  return draft;
}

/** Reads a sealed draft back; anything that is not a form draft gives `undefined`. */
export function parseFormDraft(text: string): PatientFormDraft | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(parsed)) return undefined;
  const address = addressFromDraft(parsed['address']);
  const stayAddress = addressFromDraft(parsed['stayAddress']);
  if (!address || !stayAddress) return undefined;
  const scalars: Record<string, string> = {};
  for (const key of SCALAR_DRAFT_KEYS) {
    const part = parsed[key];
    if (typeof part !== 'string') return undefined;
    scalars[key] = part;
  }
  return {
    ...(scalars as Record<(typeof SCALAR_DRAFT_KEYS)[number], string>),
    address,
    stayAddress,
  };
}

export interface DiagnosisDraftErrors {
  readonly text?: string;
  readonly icd10?: string;
}

export function diagnosisToDraft(diagnosis: EpisodeDiagnosis | undefined): {
  readonly text: string;
  readonly icd10: string;
} {
  return { text: diagnosis?.text ?? '', icd10: diagnosis?.icd10 ?? '' };
}

/** Both fields empty clears the diagnosis; a code without a wording is an error. */
export function diagnosisFromDraft(
  text: string,
  icd10: string,
):
  | { readonly diagnosis: EpisodeDiagnosis | undefined; readonly errors?: undefined }
  | { readonly diagnosis?: undefined; readonly errors: DiagnosisDraftErrors } {
  const trimmedText = text.trim();
  let code: string | undefined;
  try {
    code = normalizeIcd10Code(icd10);
  } catch (cause) {
    return { errors: { icd10: messageOf(cause) } };
  }
  if (!trimmedText) {
    return code
      ? { errors: { text: 'Укажите формулировку диагноза или очистите код.' } }
      : { diagnosis: undefined };
  }
  return { diagnosis: { text: trimmedText, ...(code ? { icd10: code } : {}) } };
}

/**
 * Applies a typed diagnosis draft to a visit. The wording and the code are one unit: while either
 * has an error the stored diagnosis stays as it was and the draft copy keeps what was typed. A
 * draft equal to the stored diagnosis returns the snapshot itself.
 */
export function applyDiagnosisDraft(
  snapshot: PatientVaultSnapshot,
  episodeId: string,
  text: string,
  icd10: string,
): { readonly snapshot: PatientVaultSnapshot; readonly errors: DiagnosisDraftErrors } {
  const result = diagnosisFromDraft(text, icd10);
  if (result.errors) return { snapshot, errors: result.errors };
  const target = snapshot.episodes.find((episode) => episode.id === episodeId);
  if (!target) throw new Error('Осмотр не найден.');
  const stored = diagnosisToDraft(target.diagnosis);
  const typed = diagnosisToDraft(result.diagnosis);
  if (stored.text === typed.text && stored.icd10 === typed.icd10) return { snapshot, errors: {} };
  return { snapshot: setEpisodeDiagnosis(snapshot, episodeId, result.diagnosis), errors: {} };
}

export function serializeDiagnosisDraft(text: string, icd10: string): string {
  return JSON.stringify({ text, icd10 });
}

export function parseDiagnosisDraft(
  value: string,
): { readonly text: string; readonly icd10: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    return typeof record['text'] === 'string' && typeof record['icd10'] === 'string'
      ? { text: record['text'], icd10: record['icd10'] }
      : undefined;
  } catch {
    return undefined;
  }
}

/** What is typed in «Новая карточка пациента» before the card exists (the photo is not kept). */
export interface NewPatientDraft {
  readonly name: string;
  readonly recordNumber: string;
  readonly birthDate: string;
  readonly sex: string;
  readonly weight: string;
  readonly height: string;
}

const NEW_PATIENT_DRAFT_KEYS = [
  'name',
  'recordNumber',
  'birthDate',
  'sex',
  'weight',
  'height',
] as const satisfies readonly (keyof NewPatientDraft)[];

export function serializeNewPatientDraft(draft: NewPatientDraft): string {
  return JSON.stringify(draft);
}

/** `undefined` for anything that is not a new-patient draft, and for an untouched one. */
export function parseNewPatientDraft(text: string): NewPatientDraft | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(parsed)) return undefined;
  const values: Record<string, string> = {};
  for (const key of NEW_PATIENT_DRAFT_KEYS) {
    const part = parsed[key];
    if (typeof part !== 'string') return undefined;
    values[key] = part;
  }
  return Object.values(values).some((part) => part !== '')
    ? (values as unknown as NewPatientDraft)
    : undefined;
}
