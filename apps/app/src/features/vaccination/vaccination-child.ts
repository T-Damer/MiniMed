import type { DiarySubject } from '@/features/vaccination/vaccination-diary';
import { parseIsoDate } from '@/features/vaccination/vaccination-plan';
import type { PatientProfile } from '@/state/patient-domain';

/**
 * Who the plan is for. A child is normally a patient card (the plan is attached to it); the doctor
 * may also just calculate from a birth date, in which case nothing is kept anywhere.
 */
export type ChildMode = 'patient' | 'quick';

export interface ChildInput {
  readonly mode: ChildMode;
  /** The selected card in `patient` mode. */
  readonly profile: PatientProfile | undefined;
  /** A birth date typed on the page (the only date in `quick` mode, a missing one in `patient`). */
  readonly typedBirthDate: string;
  /** A name typed for the sheet in `quick` mode; never stored. */
  readonly typedName: string;
  /** `patient` mode: whether the card's name goes onto the printed sheet. */
  readonly printName: boolean;
}

/** The name a card shows on a sheet: the full name when the card has one, else the display name. */
export function patientSheetName(profile: PatientProfile): string {
  return (profile.fullName ?? profile.displayName).trim();
}

/** Birth date the plan is computed from; the card's own date wins over one typed beside it. */
export function childBirthDate(input: ChildInput): string | null {
  const stored = input.mode === 'patient' ? input.profile?.birthDate : undefined;
  const candidate = stored ?? input.typedBirthDate;
  return candidate !== '' && parseIsoDate(candidate) ? candidate : null;
}

/** Whether the plan is for a card that has no birth date yet (the typed date would be new). */
export function needsBirthDateInCard(input: ChildInput): boolean {
  return (
    input.mode === 'patient' && input.profile !== undefined && input.profile.birthDate === undefined
  );
}

/** What goes onto the sheet. `null` while a patient is expected and none is chosen. */
export function diarySubjectFor(input: ChildInput): DiarySubject | null {
  if (input.mode === 'patient') {
    if (!input.profile) return null;
    return {
      name: input.printName ? patientSheetName(input.profile) : null,
      birthDate: childBirthDate(input),
    };
  }
  return {
    name: input.typedName.trim() === '' ? null : input.typedName.trim(),
    birthDate: childBirthDate(input),
  };
}
