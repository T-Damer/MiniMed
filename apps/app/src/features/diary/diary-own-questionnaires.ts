/**
 * The doctor's own questionnaires (main app «Мои опросники», files in the user library) as a
 * choice for a care diary. Doctor's side only: it reads the local library, so the patient's diary
 * must not import it — a chosen questionnaire travels inside the invitation as
 * `DiaryCheckpoint.custom` (see `diary-model.ts`).
 */
import {
  type CareSectionDraft,
  newCustomQuestionnaireSection,
} from '@/features/diary/diary-care-draft';
import { customQuestionnaireSlug } from '@/features/diary/diary-questionnaires';
import {
  questionnaireIsScored,
  userQuestionnaireReadinessError,
} from '@/state/user-questionnaire-rules';
import {
  countUserQuestionnaireImages,
  listUserQuestionnaires,
  loadUserQuestionnaire,
  type UserQuestionnaire,
} from '@/state/user-questionnaires';

export interface OwnQuestionnaireOption {
  /** Library file id: pass it to {@link loadOwnQuestionnaire} and {@link ownQuestionnaireSection}. */
  readonly id: string;
  readonly title: string;
  readonly questionCount: number;
  /** Answers carry points, so the doctor's chart gets a score line (and bands, if any). */
  readonly scored: boolean;
  /** Pictures are not sent to the patient; the editor may say so. */
  readonly imageCount: number;
  /** What blocks using it (for example the age group is not set); null when it is ready. */
  readonly problem: string | null;
  /** The checkpoint slug it will get in a diary (`own-…`). */
  readonly slug: string;
}

/** The doctor's questionnaires, in the order of «Мои опросники». Unreadable files are skipped. */
export async function listOwnQuestionnaires(): Promise<readonly OwnQuestionnaireOption[]> {
  const stored = await listUserQuestionnaires();
  return stored.map(({ file, questionnaire }) => ({
    id: file.id,
    title: file.title,
    questionCount: questionnaire.questions.length,
    scored: questionnaireIsScored(questionnaire),
    imageCount: countUserQuestionnaireImages(questionnaire),
    problem: userQuestionnaireReadinessError(questionnaire),
    slug: customQuestionnaireSlug(file.id),
  }));
}

/** One of the doctor's questionnaires by library file id (throws «Опросник не найден.»). */
export async function loadOwnQuestionnaire(id: string): Promise<UserQuestionnaire> {
  const { file, questionnaire } = await loadUserQuestionnaire(id);
  return { ...questionnaire, title: file.title };
}

/** A ready questionnaire section for the care diary editor (pictures removed). */
export async function ownQuestionnaireSection(id: string): Promise<CareSectionDraft> {
  return newCustomQuestionnaireSection(await loadOwnQuestionnaire(id), id);
}

/** «Создать свой»: the main app's questionnaire editor (blank); needs `#/assessments/mine` in the profile. */
export const OWN_QUESTIONNAIRE_NEW_HASH = '#/assessments/mine/new';
/** The list of the doctor's questionnaires. */
export const OWN_QUESTIONNAIRES_HASH = '#/assessments/mine';
/** Edit an existing one (library file id). */
export function ownQuestionnaireEditHash(id: string): string {
  return `#/assessments/mine/${encodeURIComponent(id)}/edit`;
}
