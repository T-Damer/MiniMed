import { type DoctorProfile, noteDoctorField } from './doctor-profile';
import { fieldForSpecialtySlug, fieldsForSpecialty, medicalFieldLabel } from './medical-fields';

/**
 * What reading and installing teaches the doctor's profile (on this device, never sent anywhere).
 * Both signals are weaker than choosing a sense chip (weight 1): opening a recommendation is
 * often a detour, installing a section is a deliberate but one-off act.
 */
export const RECOMMENDATION_OPENED_WEIGHT = 0.3;
export const SECTION_INSTALLED_WEIGHT = 0.6;
/** A document or a section spanning many specialties says little about any one of them. */
const MAX_FIELDS_PER_SIGNAL = 2;

const fedRecommendations = new Set<string>();

function spread(fields: readonly string[], weight: number): void {
  const picked = fields.slice(0, MAX_FIELDS_PER_SIGNAL);
  // Noted last, the field named first stays the heaviest despite the decay of the one before it.
  for (const field of picked.toReversed()) noteDoctorField(field, weight / picked.length);
}

/** Medical fields of a recommendation's catalogue specialties (slugs); `labelOf` gives their names. */
export function fieldsForSpecialtySlugs(
  specialties: readonly string[],
  labelOf: (slug: string) => string,
): readonly string[] {
  const fields: string[] = [];
  for (const slug of specialties) {
    const field = fieldForSpecialtySlug(slug) ?? fieldsForSpecialty(labelOf(slug))[0];
    if (field && !fields.includes(field)) fields.push(field);
  }
  return fields;
}

/**
 * A clinical recommendation was opened. Counted once per document and session, so reopening the
 * same text while reading does not pile up weight.
 */
export function noteRecommendationOpened(
  document: {
    readonly id: string;
    readonly sourceType: string;
    readonly specialties: readonly string[];
  },
  labelOf: (slug: string) => string,
): void {
  if (!document.sourceType.startsWith('clinical_recommendation')) return;
  if (fedRecommendations.has(document.id)) return;
  const fields = fieldsForSpecialtySlugs(document.specialties, labelOf);
  if (fields.length === 0) return;
  fedRecommendations.add(document.id);
  spread(fields, RECOMMENDATION_OPENED_WEIGHT);
}

/** Section bundles were queued for installation: each section title names its specialties. */
export function noteSectionsInstalled(titles: readonly string[]): void {
  for (const title of titles) spread(fieldsForSpecialty(title), SECTION_INSTALLED_WEIGHT);
}

/** The fields the profile points at most, heaviest first. */
export function topProfileFields(profile: DoctorProfile, count: number): readonly string[] {
  return Object.entries(profile.fields)
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, count)
    .map(([id]) => id);
}

const SHOWN_FIELDS = 3;

/** The row title: the leading fields, «…» when more are known, a plain note while it is empty. */
export function doctorProfileSummary(profile: DoctorProfile): string {
  const fields = topProfileFields(profile, SHOWN_FIELDS + 1);
  if (fields.length === 0) return 'Профиль врача: пока пуст';
  const shown = fields.slice(0, SHOWN_FIELDS).map(medicalFieldLabel).join(', ');
  return `Профиль врача: ${shown}${fields.length > SHOWN_FIELDS ? '…' : ''}`;
}

/** Test seam: forget which recommendations were already counted. */
export function resetFedRecommendations(): void {
  fedRecommendations.clear();
}
