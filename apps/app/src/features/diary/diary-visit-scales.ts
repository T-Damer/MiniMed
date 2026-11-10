/**
 * The doctor's rating of a clinician-rated scale at a visit (HAM-D 17 and the like, listed in
 * `DIARY_CLINICIAN_SCALES`), kept in the diary as a dated entry the doctor wrote. It lives in a
 * `v-<id>` record of its own, not in the patient's `e-<id>` entries: the patient's phone and any
 * older app skip records they do not know, so the rating never shows up as a self-report, and a
 * patient's record can never pass as a doctor's rating. The questions, wording and scoring stay in
 * the tool bank; an entry holds only the picked answers.
 */
import {
  createDiaryId,
  type DiaryEntry,
  DiaryFormatError,
  type DiaryInvitation,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import { DIARY_CLINICIAN_SCALES } from '@/features/diary/diary-questionnaire-list';

export const VISIT_RECORD_PREFIX = 'v-';

export function visitRecordId(entryId: string): string {
  return VISIT_RECORD_PREFIX + entryId;
}

export function isVisitRecord(recordId: string): boolean {
  return recordId.startsWith(VISIT_RECORD_PREFIX);
}

/** True when the slug is a scale the doctor can rate in this app version. */
export function isClinicianScale(slug: string): boolean {
  return DIARY_CLINICIAN_SCALES.some((scale) => scale.slug === slug);
}

/**
 * A rating read from a record (untrusted): a valid entry that names its scale. Throws
 * `DiaryFormatError` otherwise. A scale this version does not list is kept (a newer app may have
 * added it); the charts simply have nothing to score it with.
 */
export function parseVisitScaleEntry(invitation: DiaryInvitation, value: unknown): DiaryEntry {
  const entry = parseDiaryEntry(invitation, value);
  if (!entry.visitScale) throw new DiaryFormatError('Оценка на приёме без шкалы.');
  return entry;
}

/** A new rating: the scale, the answers by question id, and the day of the visit. */
export function visitScaleEntry(input: {
  readonly scale: string;
  readonly answers: Readonly<Record<string, number>>;
  /** ISO time the rating is dated with (the visit day). */
  readonly at: string;
  readonly id?: string;
}): Record<string, unknown> {
  return {
    id: input.id ?? createDiaryId(),
    at: input.at,
    values: {},
    answers: input.answers,
    visitScale: input.scale,
  };
}

/** The visit ratings of the diary, oldest first. */
export function sortedVisitEntries(
  visits: Readonly<Record<string, DiaryEntry>> | undefined,
): DiaryEntry[] {
  return Object.values(visits ?? {}).toSorted((left, right) => left.at.localeCompare(right.at));
}
