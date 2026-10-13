/**
 * The facts of a patient that a prescription uses (RX1): what the card says, what the doctor
 * entered, and what the two make together. Pure; the entries win over the card.
 */
import type { PrescriptionPatient } from '@localmed/contracts';

import {
  type PatientProfile,
  type PatientVaultSnapshot,
  patientContextSnapshot,
} from '@/state/patient-domain';
import type { PatientFacts } from './dose-population';

const DAY_MS = 86_400_000;

export interface PatientCardFacts {
  readonly ageDays: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly sex: 'female' | 'male' | null;
  readonly pregnant: boolean;
  readonly lactating: boolean;
}

export const NO_CARD_FACTS: PatientCardFacts = {
  ageDays: null,
  weightKg: null,
  heightCm: null,
  sex: null,
  pregnant: false,
  lactating: false,
};

export type PrescriptionFacts = PatientFacts & {
  readonly pregnant: boolean;
  readonly lactating: boolean;
};

function truthy(value: string | number | undefined): boolean {
  if (typeof value === 'number') return value !== 0;
  return value !== undefined && /^(?:1|да|true|yes)$/iu.test(value.trim());
}

/** What the patient's card says that the prescription uses. */
export function factsOfCard(
  profile: PatientProfile | undefined,
  snapshot: PatientVaultSnapshot | undefined,
  now: Date,
): PatientCardFacts {
  if (!profile || !snapshot) return NO_CARD_FACTS;
  const context = patientContextSnapshot(profile, snapshot, now.toISOString());
  const birth = profile.birthDate ? Date.parse(profile.birthDate) : Number.NaN;
  const ageDays = Number.isFinite(birth)
    ? Math.max(0, Math.floor((now.getTime() - birth) / DAY_MS))
    : null;
  const weight = context['weightKg'];
  const height = context['heightCm'];
  const sex = profile.biologicalSex;
  return {
    ageDays,
    weightKg: typeof weight === 'number' ? weight : null,
    heightCm: typeof height === 'number' ? height : null,
    sex: sex === 'female' || sex === 'male' ? sex : null,
    pregnant: truthy(profile.context?.['pregnancy']),
    lactating: truthy(profile.context?.['lactation']),
  };
}

/** The facts the dose arithmetic uses: the doctor's entries over the card. */
export function patientFactsOf(
  manual: PrescriptionPatient,
  card: PatientCardFacts,
): PrescriptionFacts {
  const ageDays = manual.ageDays ?? card.ageDays;
  const weightKg = manual.weightKg ?? card.weightKg;
  const heightCm = manual.heightCm ?? card.heightCm;
  const group = manual.group ?? undefined;
  return {
    ...(ageDays === null ? {} : { ageDays }),
    ...(ageDays === null && group ? { group } : {}),
    ...(weightKg === null ? {} : { weightKg }),
    ...(heightCm === null ? {} : { heightCm }),
    pregnant: manual.pregnant || card.pregnant,
    lactating: manual.lactating || card.lactating,
  };
}
