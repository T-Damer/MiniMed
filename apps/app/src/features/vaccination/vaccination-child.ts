import type { HandoutSubject } from '@/features/vaccination/vaccination-handout';
import { parseIsoDate } from '@/features/vaccination/vaccination-plan';
import type { PatientProfile } from '@/state/patient-domain';

/**
 * Who the calendar is for. A child is normally a patient card (the marks are kept with it and the
 * card's birth date is used); the doctor may also just enter a birth date, in which case nothing
 * is kept anywhere.
 */
export interface ChildInput {
  /** The selected card; without one the child is only a birth date. */
  readonly profile: PatientProfile | undefined;
  /** A birth date typed on the page: the only date without a card, a missing one in a card. */
  readonly typedBirthDate: string;
}

export const NO_CHILD: ChildInput = { profile: undefined, typedBirthDate: '' };

/** The name a card shows on a sheet: the full name when the card has one, else the display name. */
export function patientSheetName(profile: PatientProfile): string {
  return (profile.fullName ?? profile.displayName).trim();
}

/** Birth date the calendar is worked out from; the card's own date wins over one typed beside it. */
export function childBirthDate(input: ChildInput): string | null {
  const candidate = input.profile?.birthDate ?? input.typedBirthDate;
  return candidate !== '' && parseIsoDate(candidate) ? candidate : null;
}

/** Whether the typed date would be new to the card (the card has no birth date yet). */
export function needsBirthDateInCard(input: ChildInput): boolean {
  return input.profile !== undefined && input.profile.birthDate === undefined;
}

/** True once there is somebody to mark vaccinations for: a card or a valid birth date. */
export function hasChild(input: ChildInput): boolean {
  return input.profile !== undefined || childBirthDate(input) !== null;
}

/** What goes onto the handout. */
export function handoutSubjectFor(input: ChildInput): HandoutSubject {
  return {
    name: input.profile ? patientSheetName(input.profile) : null,
    birthDate: childBirthDate(input),
  };
}
