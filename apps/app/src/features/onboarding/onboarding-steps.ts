/**
 * The guided tour as data. Step 1 is the full-screen intro (it has its own phases in the
 * controller); these are steps 2..N. Texts are Russian and informal («ты»).
 */

/** Root screens the tour shows: «files» is «Мои файлы» in either navigation layout. */
export type OnboardingView = 'search' | 'files';

/** Extra content a step brings into its card. */
export type OnboardingExtra = 'drugs-download' | 'speech-download' | 'mri-viewer';

export interface OnboardingStep {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
  /** A short line under the text that must not be missed (consent, limits). */
  readonly notice?: string;
  readonly view: OnboardingView;
  /**
   * `data-tour` names of the controls this step explains, in order of preference; the first one
   * that is on screen is pointed at. Empty: the whole screen is the subject.
   */
  readonly targets: readonly string[];
  readonly extra?: OnboardingExtra;
  /** The edge glow flares for this step. */
  readonly pulse?: boolean;
  /** The last step ends the tour. */
  readonly finishLabel?: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'search',
    title: 'Поиск',
    paragraphs: [
      'Это главный экран — поиск. Здесь можно найти любую информацию по медицине, но только ту, что ты скачал.',
    ],
    view: 'search',
    targets: [],
    pulse: true,
  },
  {
    id: 'sections',
    title: 'Разделы поиска',
    paragraphs: [
      'Здесь выбираешь раздел, в котором искать.',
      'Сначала поиск находит только сами термины, но не содержимое. Для полноценного поиска скачай нужное — по своей специальности или целый раздел.',
    ],
    view: 'search',
    targets: ['section-picker'],
  },
  {
    id: 'drugs',
    title: 'Препараты',
    paragraphs: [
      'Например, у нас есть полная и обновлённая база препаратов со всеми инструкциями.',
      'Это необязательно: её можно скачать и позже, из раздела «Препараты».',
    ],
    view: 'search',
    targets: ['section-medications', 'section-picker'],
    extra: 'drugs-download',
  },
  {
    id: 'tools',
    title: 'Опросники и калькуляторы',
    paragraphs: [
      'Здесь живут опросники и калькуляторы. Результат всегда объясняется, а источник шкалы указан.',
      'Если нужной шкалы нет, можно создать свою.',
    ],
    view: 'search',
    targets: ['quick-tools'],
  },
  {
    id: 'files',
    title: 'Мои файлы',
    paragraphs: ['Твоё личное пространство:'],
    bullets: [
      'храни свои книги и ищи по ним;',
      'читай и делай заметки;',
      'смотри МРТ и КТ;',
      'безопасно храни данные пациентов;',
      'создавай свои формы для заполнения;',
      'печатай и отправляй что угодно;',
      'давай пациентам трекеры (дневники) — в приложении или на печатном листе.',
    ],
    view: 'files',
    targets: ['nav-notes'],
    extra: 'mri-viewer',
  },
  {
    id: 'ecg',
    title: 'ЭКГ по фото',
    paragraphs: [
      'Сфотографируй ленту ЭКГ — приложение оцифрует кривые и поможет с заключением.',
      'Часто точки нужно отметить руками, зато получаешь разбор.',
    ],
    notice: 'Это подсказка, а не диагноз: решение всегда за врачом.',
    view: 'search',
    targets: ['ecg-entry', 'quick-tools'],
  },
  {
    id: 'voice',
    title: 'Голос и диктофон',
    paragraphs: [
      'Голосовые заметки превращаются в текст. А на приёме можно записать беседу («Диктофон») и расшифровать её.',
      'Для расшифровки нужна локальная речевая модель — она работает на устройстве, без сети.',
    ],
    notice: 'Записывать разговор можно только с согласия пациента.',
    view: 'search',
    targets: ['all-tools'],
    extra: 'speech-download',
  },
  {
    id: 'privacy',
    title: 'Всё остаётся у тебя',
    paragraphs: [
      'Всё хранится только на твоём устройстве. Если ничего никуда не передавать — данные в безопасности.',
      'MiniMed подходит и для учёбы, и для работы.',
    ],
    view: 'search',
    targets: [],
    pulse: true,
    finishLabel: 'Начать работу',
  },
];

/** Steps shown to the user: the intro counts as the first one. */
export const ONBOARDING_TOTAL = ONBOARDING_STEPS.length + 1;
