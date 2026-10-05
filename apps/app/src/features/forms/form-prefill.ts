import {
  type FormField,
  type FormPrefillPath,
  type FormSchema,
  PATIENT_ADDRESS_PARTS,
  PATIENT_OMS_PARTS,
} from '@localmed/contracts';

import type { FormValue, FormValues } from '@/features/forms/form-values';
import type { ClinicianProfile } from '@/state/clinician-profile';
import type { ClinicalEpisode, PatientProfile } from '@/state/patient-domain';

export type FormPrefillContext = Readonly<Partial<Record<FormPrefillPath, string>>>;

export interface FormPrefillInput {
  readonly profile?: PatientProfile | undefined;
  readonly episode?: ClinicalEpisode | undefined;
  readonly clinician?: ClinicianProfile | undefined;
  readonly now: Date;
}

export interface PrefilledForm {
  readonly values: FormValues;
  /** Field ids whose current value came from a binding, for the «подставлено» mark. */
  readonly prefilled: ReadonlySet<string>;
}

/** Local calendar date, `YYYY-MM-DD`. */
export function localIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function put(
  context: Partial<Record<FormPrefillPath, string>>,
  path: FormPrefillPath,
  value: string | undefined,
): void {
  const text = value?.trim();
  if (text) context[path] = text;
}

/** Flattens the patient, episode and clinician data into the paths a schema may bind to. */
export function buildFormPrefillContext(input: FormPrefillInput): FormPrefillContext {
  const context: Partial<Record<FormPrefillPath, string>> = {};
  const { profile, episode, clinician } = input;
  if (profile) {
    put(context, 'patient.fullName', profile.fullName);
    put(context, 'patient.birthDate', profile.birthDate?.slice(0, 10));
    put(context, 'patient.sex', profile.biologicalSex);
    put(context, 'patient.snils', profile.snils);
    put(context, 'patient.workplace', profile.workplace);
    for (const part of PATIENT_ADDRESS_PARTS) {
      put(context, `patient.address.${part}`, profile.address?.[part]);
      put(context, `patient.stayAddress.${part}`, profile.stayAddress?.[part]);
    }
    for (const part of PATIENT_OMS_PARTS) {
      put(
        context,
        `patient.omsPolicy.${part}`,
        part === 'issuedAt' ? profile.omsPolicy?.issuedAt?.slice(0, 10) : profile.omsPolicy?.[part],
      );
    }
  }
  if (episode?.diagnosis) {
    put(context, 'episode.diagnosis.text', episode.diagnosis.text);
    put(context, 'episode.diagnosis.icd10', episode.diagnosis.icd10);
  }
  if (clinician) {
    put(context, 'clinician.fullName', clinician.clinicianFullName);
    put(context, 'clinician.position', clinician.clinicianPosition);
    put(context, 'organization.name', clinician.organizationName);
    put(context, 'organization.address', clinician.organizationAddress);
    put(context, 'organization.ogrn', clinician.ogrn);
  }
  context['today'] = localIsoDate(input.now);
  return context;
}

/** The value a field's binding resolves to, or `undefined` when nothing usable is known. */
export function resolveFieldPrefill(
  field: FormField,
  context: FormPrefillContext,
): FormValue | undefined {
  const binding = field.prefill;
  if (!binding) return undefined;
  const parts: string[] = [];
  for (const path of binding.sources) {
    const raw = context[path];
    if (raw === undefined) continue;
    const mapped = binding.map ? binding.map[raw] : raw;
    if (mapped !== undefined && mapped !== '') parts.push(mapped);
  }
  if (parts.length === 0) return undefined;
  const joined = parts.join(binding.join ?? ', ');
  if (field.type === 'choice') {
    const known = new Set(field.options?.map((option) => option.value));
    if (!known.has(joined)) return undefined;
    return field.multiple ? [joined] : joined;
  }
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(joined)) return undefined;
  if (field.type === 'checkbox') return undefined;
  return joined;
}

/** Applies every binding of the schema; nothing is invented for a field without a source. */
export function prefillFormValues(schema: FormSchema, context: FormPrefillContext): PrefilledForm {
  const values: Record<string, FormValue> = {};
  const prefilled = new Set<string>();
  for (const field of schema.fields) {
    const value = resolveFieldPrefill(field, context);
    if (value === undefined) continue;
    values[field.id] = value;
    prefilled.add(field.id);
  }
  return { values, prefilled };
}
