import type { PrescriptionPatient } from '@localmed/contracts';

import { parseTypedAge } from '@/features/medication-safety/age-limits';
import { ageText } from './prescription-safety';

const YEAR_DAYS = 365.25;

/** «6 лет», «8 мес», «3 года» or a bare number of years → days; null when it is not an age. */
export function parseAgeInput(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (clean === '') return null;
  const typed = parseTypedAge(clean);
  if (typed !== null) return typed;
  const years = Number(clean);
  return Number.isFinite(years) && years > 0 && years <= 120 ? Math.round(years * YEAR_DAYS) : null;
}

/**
 * The age field after a reload: what the doctor typed, while it still means the stored age; the
 * wording of the days (a card or a seed set them) otherwise.
 */
export function restoredAgeText(patient: PrescriptionPatient): string {
  const { ageDays, ageInput } = patient;
  if (ageDays === null) return '';
  if (ageInput && parseAgeInput(ageInput) === ageDays) return ageInput;
  return ageText(ageDays);
}

/** What typing `text` into the age field changes in the draft: the typed text and the days it means. */
export function agePatchOf(text: string): Partial<PrescriptionPatient> {
  const days = parseAgeInput(text);
  return {
    ageDays: days,
    ageInput: text.trim() === '' ? null : text,
    ...(days === null ? {} : { group: null }),
  };
}
