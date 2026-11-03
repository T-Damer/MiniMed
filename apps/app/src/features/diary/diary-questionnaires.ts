/**
 * Self-report questionnaires a doctor can put into a care diary: every scale of the app's tool
 * packs that the patient fills in themselves (clinician-rated ones such as HAM-D stay with the
 * doctor), psychiatric screening scales and psychological profiles alike (owner 2026-11-03), and
 * only scales whose rights notice allows reproduction. The definitions come from the same packs
 * the app's assessments use and are loaded on first use. A doctor can also embed a questionnaire
 * of their own (main app «Мои опросники»): it travels inside the checkpoint
 * (`DiaryCheckpoint.custom`) and goes through the same conversion as the built-in ones.
 */
import type { ToolDefinitionRecord } from '@localmed/contracts';
import { pluralize } from '@/diary/diary-format';
import { assessmentDefinitionFromRecord } from '@/features/assessments/assessment-definition';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import type { DiaryCheckpoint } from '@/features/diary/diary-model';
import { userQuestionnaireDefinition } from '@/state/user-questionnaire-format';

/** The tool pack a built-in questionnaire comes from (content/tool-modules). */
type QuestionnairePack = 'psychology' | 'obstetrics-gynecology';

const PACKS: Readonly<Record<QuestionnairePack, () => Promise<{ readonly default: unknown }>>> = {
  psychology: () => import('../../../../../content/tool-modules/psychology.json'),
  'obstetrics-gynecology': () =>
    import('../../../../../content/tool-modules/obstetrics-gynecology.json'),
};

export interface DiaryQuestionnaireOption {
  readonly slug: string;
  /** The section of «Тесты и опросники» the app's own page for the scale lives under (its route). */
  readonly bank: 'psychiatry' | 'psychology' | 'obstetrics';
  /** Short name on the patient's button and in the doctor's chips. */
  readonly title: string;
  /** What it measures, in plain words. */
  readonly about: string;
  readonly pack: QuestionnairePack;
  /**
   * A profile of several scales without one total (temperament, roles): the doctor sees each
   * result's headline, not a line of totals.
   */
  readonly profile?: true;
}

export const DIARY_QUESTIONNAIRES: readonly DiaryQuestionnaireOption[] = [
  { slug: 'phq-9', bank: 'psychiatry', title: 'PHQ-9', about: 'настроение', pack: 'psychology' },
  { slug: 'gad-7', bank: 'psychiatry', title: 'GAD-7', about: 'тревога', pack: 'psychology' },
  {
    slug: 'zung-self-rating-depression',
    bank: 'psychiatry',
    title: 'Шкала Цунга',
    about: 'депрессия',
    pack: 'psychology',
  },
  {
    slug: 'zung-self-rating-anxiety',
    bank: 'psychiatry',
    title: 'Шкала Цунга',
    about: 'тревога',
    pack: 'psychology',
  },
  {
    slug: 'asthenic-state-shas',
    bank: 'psychiatry',
    title: 'ШАС',
    about: 'астения',
    pack: 'psychology',
  },
  {
    slug: 'perinatal-mood-whooley',
    bank: 'obstetrics',
    title: 'Вопросы Whooley',
    about: 'депрессия, 2 вопроса',
    pack: 'obstetrics-gynecology',
  },
  {
    slug: 'postnatal-mood-epds',
    bank: 'obstetrics',
    title: 'EPDS',
    about: 'депрессия при беременности и после родов',
    pack: 'obstetrics-gynecology',
  },
  {
    slug: 'temperament-profile',
    bank: 'psychology',
    title: 'Темперамент',
    about: 'черты характера',
    pack: 'psychology',
    profile: true,
  },
  {
    slug: 'personal-egogram',
    bank: 'psychology',
    title: 'Эгопрограмма',
    about: 'эго-состояния',
    pack: 'psychology',
    profile: true,
  },
  {
    slug: 'braverman-behavioral-profile',
    bank: 'psychology',
    title: 'Профиль Бравермана',
    about: 'поведенческий профиль',
    pack: 'psychology',
    profile: true,
  },
  {
    slug: 'paei-work-style',
    bank: 'psychology',
    title: 'PAEI',
    about: 'стиль работы',
    pack: 'psychology',
    profile: true,
  },
  {
    slug: 'team-role-profile',
    bank: 'psychology',
    title: 'Командные роли',
    about: 'роль в команде',
    pack: 'psychology',
    profile: true,
  },
];

export function diaryQuestionnaire(slug: string): DiaryQuestionnaireOption | undefined {
  return DIARY_QUESTIONNAIRES.find((option) => option.slug === slug);
}

/** Checkpoint ids stay within the diary's 24-character id pattern. */
export function questionnaireCheckpointId(slug: string): string {
  return `q-${slug}`.slice(0, 24);
}

/**
 * The slug of a doctor's own questionnaire, derived from its library file id so that issuing the
 * same questionnaire again keeps the checkpoint id and the patient's earlier answers match.
 */
export function customQuestionnaireSlug(sourceId: string): string {
  // Two independent 32-bit hashes, four base-36 characters each; collisions among one doctor's
  // few questionnaires are negligible and a clash only merges two checkpoint ids.
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < sourceId.length; index += 1) {
    const code = sourceId.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second + code, 0x85ebca6b) >>> 0;
  }
  const pad = (value: number): string => value.toString(36).padStart(7, '0').slice(-4);
  return `own-${pad(first)}${pad(second)}`;
}

const loaded = new Map<string, Promise<AssessmentDefinition>>();

export function loadDiaryQuestionnaire(slug: string): Promise<AssessmentDefinition> {
  const cached = loaded.get(slug);
  if (cached) return cached;
  const option = diaryQuestionnaire(slug);
  if (!option) return Promise.reject(new Error('Этот опросник не входит в дневник.'));
  const promise = PACKS[option.pack]().then((pack) => {
    const tools = (pack.default as { readonly tools: readonly ToolDefinitionRecord[] }).tools;
    const record = tools.find((tool) => tool.slug === slug);
    if (!record) throw new Error('Опросник не найден.');
    return assessmentDefinitionFromRecord(record);
  });
  loaded.set(slug, promise);
  promise.catch(() => loaded.delete(slug));
  return promise;
}

/**
 * The definition behind a questionnaire checkpoint: a built-in one from the pack, a doctor's own
 * from the questionnaire embedded in the checkpoint. The one entry point for patient sheets and
 * the doctor's scoring.
 */
export function loadCheckpointQuestionnaire(
  checkpoint: Pick<DiaryCheckpoint, 'questionnaire' | 'custom'>,
): Promise<AssessmentDefinition> {
  if (checkpoint.custom) {
    try {
      return Promise.resolve(
        userQuestionnaireDefinition(checkpoint.custom, {
          id: checkpoint.questionnaire ?? 'own',
          title: checkpoint.custom.title,
        }),
      );
    } catch (cause) {
      return Promise.reject(cause);
    }
  }
  if (!checkpoint.questionnaire) return Promise.reject(new Error('Не указан опросник.'));
  return loadDiaryQuestionnaire(checkpoint.questionnaire);
}

/** A few words on what the questionnaire measures, for the list row. */
export function checkpointQuestionnaireAbout(
  checkpoint: Pick<DiaryCheckpoint, 'questionnaire' | 'custom'>,
): string {
  if (checkpoint.custom) {
    const count = checkpoint.custom.questions.length;
    return `${count} ${pluralize(count, 'вопрос', 'вопроса', 'вопросов')}`;
  }
  return diaryQuestionnaire(checkpoint.questionnaire ?? '')?.about ?? '';
}
