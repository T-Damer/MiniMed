/**
 * Voluntary participation in a research study, apart from the three joining documents: the doctor
 * registers the study in the plan (`DiaryInvitation.study`, the consent text approved by the ethics
 * committee, pasted by the doctor), the patient answers on the phone, and the answer travels in
 * the encrypted `consent` record next to the joining acceptances. Declining or withdrawing never
 * changes the treatment or the diary. The app ships no consent wording of its own, only labels.
 */
import type { DiaryStudy } from '@/features/diary/diary-model';

export const STUDY_ANSWER_STATUSES = ['accepted', 'declined', 'withdrawn'] as const;

export type StudyAnswerStatus = (typeof STUDY_ANSWER_STATUSES)[number];

/** What the patient answered, for one study in one version of its text. */
export interface StudyAnswer {
  /** `DiaryStudy.id`. */
  readonly study: string;
  /** `DiaryStudy.version` the patient saw when answering. */
  readonly version: string;
  readonly status: StudyAnswerStatus;
  /** ISO time of the answer. */
  readonly at: string;
}

const MAX_LABEL = 200;
const STUDY_ID = /^[a-z0-9]{6,24}$/u;

/** An answer read from storage or a record (untrusted); anything broken is no answer. */
export function parseStudyAnswer(value: unknown): StudyAnswer | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { study, version, status, at } = value as Record<string, unknown>;
  if (typeof study !== 'string' || !STUDY_ID.test(study)) return undefined;
  if (typeof version !== 'string' || !version || version.length > MAX_LABEL) return undefined;
  if (!(STUDY_ANSWER_STATUSES as readonly unknown[]).includes(status)) return undefined;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return undefined;
  return { study, version, status: status as StudyAnswerStatus, at };
}

/** The answer the patient gives now to the study as it stands in the plan. */
export function studyAnswer(
  study: Pick<DiaryStudy, 'id' | 'version'>,
  status: StudyAnswerStatus,
  at: Date = new Date(),
): StudyAnswer {
  return { study: study.id, version: study.version, status, at: at.toISOString() };
}

/** Of two answers, the later one (a second phone of the same patient may have answered). */
export function laterStudyAnswer(
  left: StudyAnswer | undefined,
  right: StudyAnswer | undefined,
): StudyAnswer | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right.at) > Date.parse(left.at) ? right : left;
}

/** Sync bookkeeping: what the server holds of the consent record, to tell when to send it again. */
export function studyAnswerFingerprint(answer: StudyAnswer | undefined): string {
  return answer ? `1|${answer.study}|${answer.version}|${answer.status}|${answer.at}` : '1';
}

export type StudyConsentStatus =
  /** The diary is not part of a study. */
  | { readonly kind: 'none' }
  /**
   * No valid answer yet: the patient has not answered, or answered another study or an earlier
   * version of the text (`outdated`), which asks again.
   */
  | { readonly kind: 'unanswered'; readonly outdated: boolean }
  | { readonly kind: 'participates'; readonly at: string }
  | { readonly kind: 'declined'; readonly at: string }
  | { readonly kind: 'withdrawn'; readonly at: string };

/**
 * Where a diary stands with its study, from the plan's `study` and the patient's latest answer
 * (`DiaryReplica.study` on the doctor's device, `DiaryMeta.study` on the phone). Pure.
 *
 * - no `study`: `none` (whatever the answer says);
 * - an answer for this study and version: `participates` / `declined` / `withdrawn`;
 * - a withdrawal of this study counts in any version: the patient said stop;
 * - otherwise (no answer, another study, an earlier version of the text): `unanswered`.
 *
 * Only `participates` is consent: use {@link isStudyParticipant}.
 */
export function studyConsentStatus(
  study: Pick<DiaryStudy, 'id' | 'version'> | undefined,
  answer: StudyAnswer | undefined,
): StudyConsentStatus {
  if (!study) return { kind: 'none' };
  if (!answer || answer.study !== study.id) return { kind: 'unanswered', outdated: false };
  if (answer.status === 'withdrawn') return { kind: 'withdrawn', at: answer.at };
  if (answer.version !== study.version) return { kind: 'unanswered', outdated: true };
  return answer.status === 'accepted'
    ? { kind: 'participates', at: answer.at }
    : { kind: 'declined', at: answer.at };
}

/** True only for a patient who agreed to this study in its current version and has not withdrawn. */
export function isStudyParticipant(status: StudyConsentStatus): boolean {
  return status.kind === 'participates';
}

/** The doctor's word for the status; nothing for a diary outside a study. */
export function studyStatusLabel(status: StudyConsentStatus): string | undefined {
  switch (status.kind) {
    case 'none':
      return undefined;
    case 'participates':
      return 'участвует';
    case 'declined':
      return 'отказался';
    case 'withdrawn':
      return 'отозвал';
    case 'unanswered':
      return 'не ответил';
  }
}
