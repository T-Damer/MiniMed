/**
 * The built-in questionnaires a care diary can carry, as data. A module of its own without
 * imports, so the build configuration (`vite.config.ts`) can read the slugs to cut the diaries
 * copy's tool packs down to these scales; `diary-questionnaires.ts` re-exports it.
 */

/** The tool pack a built-in questionnaire comes from (content/tool-modules). */
export type QuestionnairePack = 'psychology' | 'obstetrics-gynecology';

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
  // Alcohol (NARCO1, owner 2026-11-04): the WHO risk tests and the craving and thoughts scale.
  {
    slug: 'rus-audit-s',
    bank: 'psychiatry',
    title: 'RUS-AUDIT-S',
    about: 'алкоголь, 3 вопроса',
    pack: 'psychology',
  },
  {
    slug: 'rus-audit',
    bank: 'psychiatry',
    title: 'RUS-AUDIT',
    about: 'алкоголь за год',
    pack: 'psychology',
  },
  {
    slug: 'ocds-alcohol-craving',
    bank: 'psychiatry',
    title: 'OCDS',
    about: 'мысли об алкоголе и тяга',
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

/**
 * Scales the doctor rates at a visit (clinician-rated, so never a patient's checkpoint): a small
 * data list, each scale one record of the same tool packs. To offer another one, add its slug
 * here; its text, scoring and rights notice stay in the pack. The diaries copy keeps these
 * records too (`vite.config.ts`).
 */
export const DIARY_CLINICIAN_SCALES: readonly DiaryQuestionnaireOption[] = [
  {
    slug: 'hamilton-depression-rating-scale',
    bank: 'psychiatry',
    title: 'HAM-D 17',
    about: 'депрессия, оценка врача',
    pack: 'psychology',
  },
];
