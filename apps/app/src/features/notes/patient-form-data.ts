import {
  type EpisodeDiagnosis,
  normalizeIcd10Code,
  normalizeSnils,
  PATIENT_ADDRESS_FIELDS,
  type PatientAddress,
  type PatientProfile,
  type PatientProfileDataPatch,
} from '@/state/patient-domain';

/** Flat, string-only editing state for the form-data panel. */
export interface PatientFormDraft {
  readonly fullName: string;
  readonly snils: string;
  readonly omsNumber: string;
  readonly omsIssuedAt: string;
  readonly omsInsurer: string;
  readonly workplace: string;
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
 * Converts the editing state to a full patch (empty fields remove stored values) or reports inline
 * errors. Light validation only: SNILS shape and "policy dates need a policy number".
 */
export function draftToPatch(
  draft: PatientFormDraft,
):
  | { readonly patch: PatientProfileDataPatch; readonly errors?: undefined }
  | { readonly patch?: undefined; readonly errors: PatientFormDraftErrors } {
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
  if (snilsError || omsError) {
    return {
      errors: {
        ...(snilsError ? { snils: snilsError } : {}),
        ...(omsError ? { omsNumber: omsError } : {}),
      },
    };
  }
  return {
    patch: {
      fullName: draft.fullName,
      snils,
      omsPolicy: omsNumber
        ? {
            number: omsNumber,
            ...(omsIssuedAt ? { issuedAt: omsIssuedAt } : {}),
            ...(omsInsurer ? { insurer: omsInsurer } : {}),
          }
        : undefined,
      workplace: draft.workplace,
      address: { ...draft.address },
      stayAddress: { ...draft.stayAddress },
    },
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
