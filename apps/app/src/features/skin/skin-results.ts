import {
  SKIN_CLASSES,
  type SkinAnalysis,
  type SkinClass,
  type SkinPrediction,
} from '@/features/skin/skin-model';
import { pluralRu } from '@/i18n/labels';

/** The page shows the first one to three conditions. */
export const MAX_SKIN_RESULTS = 3;
/** A second or third condition earns a card only when it is a real contender. */
export const MIN_SECONDARY_PROBABILITY = 0.08;

const CLASSES_BY_ID: ReadonlyMap<string, SkinClass> = new Map(
  SKIN_CLASSES.map((entry) => [entry.id, entry]),
);

export function skinClassById(id: string): SkinClass | undefined {
  return CLASSES_BY_ID.get(id);
}

export interface SkinResultView {
  readonly classId: string;
  readonly name: string;
  /** Whole percent, never below 1. */
  readonly percent: number;
  /** Bar fill, 0–1. */
  readonly fill: number;
  readonly icd10: readonly string[];
  readonly malignant: boolean;
}

export function percentOf(probability: number): number {
  return Math.min(100, Math.max(1, Math.round(probability * 100)));
}

/** The conditions to show: always the first, then up to two more that are close enough to matter. */
export function visiblePredictions(
  predictions: readonly Pick<SkinPrediction, 'classId' | 'probability'>[],
): readonly SkinPrediction[] {
  const known = predictions.filter((entry) => CLASSES_BY_ID.has(entry.classId));
  return known
    .filter((entry, index) => index === 0 || entry.probability >= MIN_SECONDARY_PROBABILITY)
    .slice(0, MAX_SKIN_RESULTS);
}

export function skinResultViews(
  predictions: readonly Pick<SkinPrediction, 'classId' | 'probability'>[],
): readonly SkinResultView[] {
  return visiblePredictions(predictions).flatMap((entry) => {
    const skinClass = CLASSES_BY_ID.get(entry.classId);
    if (!skinClass) return [];
    return [
      {
        classId: skinClass.id,
        name: skinClass.ru,
        percent: percentOf(entry.probability),
        fill: Math.min(1, Math.max(0.02, entry.probability)),
        icd10: skinClass.icd10,
        malignant: skinClass.malignant,
      },
    ];
  });
}

export interface SkinStatusLine {
  readonly kind: 'uncertain' | 'malignant';
  readonly text: string;
}

/** One plain line per fact; nothing when neither fired. */
export function skinStatusLines(
  analysis: Pick<SkinAnalysis, 'uncertain' | 'malignantFlag'>,
): readonly SkinStatusLine[] {
  return [
    ...(analysis.malignantFlag
      ? [
          {
            kind: 'malignant' as const,
            text: 'Признаки злокачественного образования: проверка сработала',
          },
        ]
      : []),
    ...(analysis.uncertain
      ? [{ kind: 'uncertain' as const, text: 'Модель не уверена: варианты близки по сходству' }]
      : []),
  ];
}

/** «Сравниваю с 21 состоянием» — the instrumental case follows the count. */
export function skinComparingLine(count = SKIN_CLASSES.length): string {
  return `Сравниваю с ${count} ${pluralRu(count, 'состоянием', 'состояниями', 'состояниями')}…`;
}

export const SKIN_SCAN_STATUS_LINES = (count = SKIN_CLASSES.length): readonly string[] => [
  'Проверяю качество…',
  skinComparingLine(count),
  'Ранжирую сходство…',
];

/** МКБ-10 codes of a class as one short string, empty when the class has none. */
export function icd10Text(codes: readonly string[]): string {
  return codes.join(' · ');
}
