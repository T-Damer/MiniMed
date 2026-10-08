import type { AppGlyphName } from '@/components/AppGlyph';

/**
 * The settings sections, in the order of the list. Pure data: titles, icons, which inset group a
 * row belongs to and the words the filter field searches in addition to the title. The status on
 * the right of a row is computed from live state in `settings-status.ts`, never stored here.
 */
export type SettingsPageId =
  | 'general'
  | 'clinician'
  | 'downloads'
  | 'ai'
  | 'images'
  | 'appearance'
  | 'data';

export type SettingsTileTone = 'blue' | 'orange' | 'green' | 'purple' | 'pink' | 'gray' | 'teal';

export interface SettingsPageDefinition {
  readonly id: SettingsPageId;
  readonly title: string;
  /** One line under the sub-page title. */
  readonly description: string;
  readonly icon: AppGlyphName;
  readonly tone: SettingsTileTone;
  /** Extra words the filter matches: the cards and switches the page holds. */
  readonly keywords: readonly string[];
}

export const SETTINGS_PAGES: readonly SettingsPageDefinition[] = [
  {
    id: 'general',
    title: 'Основные',
    description: 'Версия, обновления и обучение.',
    icon: 'system-fill',
    tone: 'gray',
    keywords: [
      'обновление',
      'версия',
      'автообновление',
      'обучение',
      'экскурсия',
      'техническая информация',
      'ссылки',
      'ядро поиска',
      'о приложении',
    ],
  },
  {
    id: 'clinician',
    title: 'Врач и организация',
    description: 'Подставляются в справки и формы. Хранятся на устройстве.',
    icon: 'users',
    tone: 'blue',
    keywords: ['огрн', 'организация', 'должность', 'фио', 'формы', 'справки'],
  },
  {
    id: 'downloads',
    title: 'Загрузки и разделы',
    description: 'Что на устройстве и что можно скачать.',
    icon: 'download-fill',
    tone: 'green',
    keywords: ['разделы', 'очередь', 'скачать', 'специальность', 'упаковки'],
  },
  {
    id: 'ai',
    title: 'Функции ИИ',
    description: 'Модели на устройстве, без интернета.',
    icon: 'brain-fill',
    tone: 'purple',
    keywords: [
      'поиск по смыслу',
      'e5',
      'расшифровка',
      'голос',
      'asr',
      'whisper',
      'экг',
      'модель',
      'ocr',
      'распознавание текста',
      'скан',
      'tesseract',
    ],
  },
  {
    id: 'images',
    title: 'Изображения',
    description: 'Иллюстрации и предварительные материалы.',
    icon: 'image-fill',
    tone: 'orange',
    keywords: ['картинки', 'справочные изображения', 'иллюстрации', 'предварительные', 'черновики'],
  },
  {
    id: 'appearance',
    title: 'Внешний вид',
    description: 'Тема, анимации, звуки, вкладки.',
    icon: 'palette',
    tone: 'pink',
    keywords: ['тема', 'тёмная', 'анимации', 'звуки', 'вибрация', 'вкладки', 'плавающие окна'],
  },
  {
    id: 'data',
    title: 'Пациенты и данные',
    description: 'Карточки пациентов и резервная копия.',
    icon: 'lock',
    tone: 'teal',
    keywords: ['пациенты', 'хранилище', 'резервная копия', 'backup', 'заметки', 'шифрование'],
  },
];

/** Inset groups of the top-level list; each row is a page id. */
export const SETTINGS_GROUPS: readonly (readonly SettingsPageId[])[] = [
  ['general', 'clinician'],
  ['downloads', 'ai', 'images'],
  ['appearance', 'data'],
];

export function settingsPage(id: SettingsPageId): SettingsPageDefinition {
  const page = SETTINGS_PAGES.find((candidate) => candidate.id === id);
  if (!page) throw new Error(`Неизвестный раздел настроек: ${id}`);
  return page;
}

export function isSettingsPageId(value: string): value is SettingsPageId {
  return SETTINGS_PAGES.some((page) => page.id === value);
}

/** Pages whose title, description or keywords contain every word of the query. */
export function filterSettingsPages(query: string): readonly SettingsPageDefinition[] {
  const words = query.toLocaleLowerCase('ru').split(/\s+/u).filter(Boolean);
  if (words.length === 0) return SETTINGS_PAGES;
  return SETTINGS_PAGES.filter((page) => {
    const haystack = [page.title, page.description, ...page.keywords]
      .join(' ')
      .toLocaleLowerCase('ru');
    return words.every((word) => haystack.includes(word));
  });
}
