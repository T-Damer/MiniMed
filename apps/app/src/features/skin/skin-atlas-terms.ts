/**
 * The vocabulary of the skin atlas: danger levels, morphological elements, colours and the signs a
 * doctor can tick. Declared once as data; the atlas, the description chips and the pictures all use
 * these ids and labels, and no component branches on one of them.
 */
import { SKIN_SITES, type SkinSymptom } from '@/features/skin/skin-model';

/** Lowest first: `urgent` needs care the same day. */
export const SKIN_DANGER_LEVELS = ['low', 'moderate', 'high', 'urgent'] as const;
export type SkinDangerLevel = (typeof SKIN_DANGER_LEVELS)[number];

export const SKIN_DANGER_LABELS: Record<SkinDangerLevel, string> = {
  low: 'Низкая опасность',
  moderate: 'Умеренная опасность',
  high: 'Высокая опасность',
  urgent: 'Неотложно',
};

/** One word for a chip on a card. */
export const SKIN_DANGER_SHORT: Record<SkinDangerLevel, string> = {
  low: 'Низкая',
  moderate: 'Умеренная',
  high: 'Высокая',
  urgent: 'Неотложно',
};

export function dangerRank(level: SkinDangerLevel): number {
  return SKIN_DANGER_LEVELS.indexOf(level);
}

export function maxDanger(levels: readonly SkinDangerLevel[]): SkinDangerLevel | undefined {
  return levels.reduce<SkinDangerLevel | undefined>(
    (best, level) => (best === undefined || dangerRank(level) > dangerRank(best) ? level : best),
    undefined,
  );
}

export const SKIN_ELEMENTS = [
  'macule',
  'papule',
  'plaque',
  'nodule',
  'vesicle',
  'bulla',
  'pustule',
  'wheal',
  'erosion',
  'ulcer',
  'crust',
  'scale',
  'comedo',
  'petechia',
] as const;
export type SkinElement = (typeof SKIN_ELEMENTS)[number];

export const SKIN_ELEMENT_LABELS: Record<SkinElement, string> = {
  macule: 'Пятно',
  papule: 'Папула',
  plaque: 'Бляшка',
  nodule: 'Узел',
  vesicle: 'Пузырёк',
  bulla: 'Пузырь',
  pustule: 'Гнойничок',
  wheal: 'Волдырь',
  erosion: 'Эрозия',
  ulcer: 'Язва',
  crust: 'Корка',
  scale: 'Шелушение',
  comedo: 'Комедоны',
  petechia: 'Точечные кровоизлияния',
};

export const SKIN_COLORS = [
  'skin',
  'white',
  'pink',
  'red',
  'brown',
  'black',
  'blue_gray',
  'yellow',
  'purple',
] as const;
export type SkinColor = (typeof SKIN_COLORS)[number];

export const SKIN_COLOR_LABELS: Record<SkinColor, string> = {
  skin: 'Цвета кожи',
  white: 'Белый',
  pink: 'Розовый',
  red: 'Красный',
  brown: 'Коричневый',
  black: 'Чёрный',
  blue_gray: 'Серо-синий',
  yellow: 'Жёлтый',
  purple: 'Фиолетовый',
};

/** Swatches for the colour chips (the picture palette is in skin-lesion-art). */
export const SKIN_COLOR_SWATCHES: Record<SkinColor, string> = {
  skin: '#e2b496',
  white: '#f8f1ea',
  pink: '#eba3a0',
  red: '#c8463f',
  brown: '#87573a',
  black: '#2a1c19',
  blue_gray: '#5d6c84',
  yellow: '#efd27b',
  purple: '#8b4a78',
};

/** Signs beyond the model's symptoms; several are red flags of one condition or another. */
export const SKIN_SIGNS = [
  'fever',
  'mucosa',
  'near_eye',
  'non_healing',
  'spreading',
  'blisters_wide',
  'new_drug',
  'face_swelling',
] as const;
export type SkinSign = (typeof SKIN_SIGNS)[number];

export const SKIN_SIGN_LABELS: Record<SkinSign, string> = {
  fever: 'Лихорадка',
  mucosa: 'На слизистой',
  near_eye: 'У глаза',
  non_healing: 'Не заживает',
  spreading: 'Быстро распространяется',
  blisters_wide: 'Отслойка кожи',
  new_drug: 'Новое лекарство',
  face_swelling: 'Отёк лица, губ',
};

/** What a red flag can be triggered by: a ticked sign, or a symptom marked present. */
export type SkinTrigger = SkinSign | SkinSymptom;

/** The model's sites plus the mouth, which only the atlas knows (Koplik spots, aphthae). */
export const SKIN_ATLAS_SITES = [...SKIN_SITES, 'mouth'] as const;
export type SkinAtlasSite = (typeof SKIN_ATLAS_SITES)[number];
