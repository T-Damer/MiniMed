/**
 * The guided tour as data. Step 1 is the full-screen intro (it has its own phases in the
 * controller); these are steps 2..N. Texts are Russian and informal («ты»).
 */

/** Root screens the tour shows: «files» is «Мои файлы» in either navigation layout. */
export type OnboardingView = 'search' | 'files';

/** Extra content a step brings into its card. */
export type OnboardingExtra = 'sections-download' | 'speech-download' | 'mri-viewer';

export interface OnboardingStep {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
  /**
   * A one-line summary of the bullets: when set, the list sits in a collapsed accordion headed by
   * it, so a long list does not take over the card.
   */
  readonly bulletsSummary?: string;
  /** A short line under the text that must not be missed (consent, limits). */
  readonly notice?: string;
  readonly view: OnboardingView;
  /**
   * `data-tour` names of the controls this step explains, in order of preference; the first one
   * that is on screen is pointed at. Empty: the whole screen is the subject.
   */
  readonly targets: readonly string[];
  readonly extra?: OnboardingExtra;
  /** The target is spotlit: a pulsing ring, the rest of the screen dimmed a little. */
  readonly spotlight?: boolean;
  /** The last step ends the tour. */
  readonly finishLabel?: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'search',
    title: 'Поиск',
    paragraphs: [
      'Это главный экран — поиск. Здесь можно найти любую информацию по медицине, но только ту, что ты скачал.',
      'Нижняя панель переключает разделы: поиск, файлы, лента новостей и настройки.',
    ],
    view: 'search',
    targets: ['nav'],
    spotlight: true,
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
    id: 'specialty',
    title: 'Скачать по специальности',
    paragraphs: [
      'Выбери специальность: скачаем её клинические рекомендации и препараты, которые в них названы. Стрелка справа покажет состав раздела.',
      'Это необязательно — то же самое есть в «Настройки → Загрузки». Полную базу препаратов можно скачать позже, из раздела «Препараты».',
    ],
    view: 'search',
    targets: [],
    extra: 'sections-download',
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
    paragraphs: ['Твоё личное пространство.'],
    bulletsSummary: 'Книги, заметки, МРТ и КТ, пациенты, формы, печать, трекеры',
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
    finishLabel: 'Начать работу',
  },
];

/** Steps shown to the user: the intro counts as the first one. */
export const ONBOARDING_TOTAL = ONBOARDING_STEPS.length + 1;
