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
  | 'data'
  | 'about';

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
    description: 'Обновление приложения, автообновление материалов и обучение.',
    icon: 'system-fill',
    tone: 'gray',
    keywords: ['обновление', 'версия', 'автообновление', 'обучение', 'экскурсия'],
  },
  {
    id: 'clinician',
    title: 'Врач и организация',
    description: 'Подставляются в официальные формы. Хранится только на этом устройстве.',
    icon: 'users',
    tone: 'blue',
    keywords: ['огрн', 'организация', 'должность', 'фио', 'формы', 'справки'],
  },
  {
    id: 'downloads',
    title: 'Загрузки и разделы',
    description: 'Что уже на устройстве, что скачивается сейчас и что можно скачать.',
    icon: 'download-fill',
    tone: 'green',
    keywords: ['разделы', 'очередь', 'скачать', 'специальность', 'упаковки'],
  },
  {
    id: 'ai',
    title: 'Функции ИИ',
    description: 'Модели, которые работают на устройстве без интернета.',
    icon: 'brain-fill',
    tone: 'purple',
    keywords: ['поиск по смыслу', 'e5', 'расшифровка', 'голос', 'asr', 'whisper', 'экг', 'модель'],
  },
  {
    id: 'images',
    title: 'Изображения и дополнительно',
    description: 'Иллюстрации справочника и предварительные материалы.',
    icon: 'image-fill',
    tone: 'orange',
    keywords: ['картинки', 'справочные изображения', 'иллюстрации', 'предварительные', 'черновики'],
  },
  {
    id: 'appearance',
    title: 'Внешний вид',
    description: 'Тема, анимации, звуки и расположение вкладок.',
    icon: 'palette',
    tone: 'pink',
    keywords: ['тема', 'тёмная', 'анимации', 'звуки', 'вибрация', 'вкладки', 'плавающие окна'],
  },
  {
    id: 'data',
    title: 'Пациенты и данные',
    description: 'Где хранятся карточки пациентов и как сохранить резервную копию.',
    icon: 'lock',
    tone: 'teal',
    keywords: ['пациенты', 'хранилище', 'резервная копия', 'backup', 'заметки', 'шифрование'],
  },
  {
    id: 'about',
    title: 'О приложении',
    description: 'Версия, состояние поиска и ссылки.',
    icon: 'info',
    tone: 'blue',
    keywords: ['техническая информация', 'ссылки', 'версия', 'ядро поиска'],
  },
];

/** Inset groups of the top-level list; each row is a page id. */
export const SETTINGS_GROUPS: readonly (readonly SettingsPageId[])[] = [
  ['general', 'clinician'],
  ['downloads', 'ai', 'images'],
  ['appearance', 'data'],
  ['about'],
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
