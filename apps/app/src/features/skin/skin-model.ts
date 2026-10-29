/**
 * Skin photo model: the contract between the «Кожа по фото» page and the on-device classifier.
 *
 * The model (EfficientNet-B0 fused with optional patient details, tools/derm-cnn) runs in a worker
 * with ONNX Runtime web; its weights are trained on data that stays local (docs/research/
 * skin-photo-classifier-2026-10-29.md), so they are not in the repository: a build finds them at
 * `models/skin/` beside the app (see `SKIN_MODEL_URL`) or reports the model as missing. The class
 * list is declared data (`skin-classes.json`): the model's output order is its order.
 */
import skinClassesJson from '@/features/skin/skin-classes.json';

export interface SkinClass {
  readonly id: string;
  /** Russian name for the UI. */
  readonly ru: string;
  /** МКБ-10 codes that link the class to the app's documents; may be empty. */
  readonly icd10: readonly string[];
  readonly malignant: boolean;
}

export const SKIN_CLASSES: readonly SkinClass[] = skinClassesJson.classes.map((entry) => ({
  id: entry.id,
  ru: entry.ru,
  icd10: entry.icd10,
  malignant: entry.malignant,
}));

export const SKIN_AGE_BUCKETS = [
  'lt18',
  '18_29',
  '30_39',
  '40_49',
  '50_59',
  '60_69',
  '70plus',
] as const;
export const SKIN_SITES = [
  'head_neck',
  'arm',
  'hand',
  'torso',
  'genital',
  'buttocks',
  'leg',
  'foot',
] as const;
export const SKIN_SYMPTOMS = ['itch', 'bleed', 'grew', 'pain', 'changed', 'raised'] as const;
export const SKIN_DURATIONS = ['lt_week', '1_4_weeks', '1_12_months', 'gt_year'] as const;

export type SkinAgeBucket = (typeof SKIN_AGE_BUCKETS)[number];
export type SkinSite = (typeof SKIN_SITES)[number];
export type SkinSymptom = (typeof SKIN_SYMPTOMS)[number];
export type SkinDuration = (typeof SKIN_DURATIONS)[number];

/** What the doctor told the tool; every field is optional and unknown by default. */
export interface SkinDetails {
  readonly age?: SkinAgeBucket;
  readonly sex?: 'male' | 'female';
  readonly sites?: readonly SkinSite[];
  /** true: present, false: absent, missing: not asked. */
  readonly symptoms?: Partial<Readonly<Record<SkinSymptom, boolean>>>;
  readonly duration?: SkinDuration;
  /** Fitzpatrick skin type 1–6. */
  readonly fitzpatrick?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Age in full years → the model's bucket. */
export function skinAgeBucket(years: number): SkinAgeBucket {
  if (years < 18) return 'lt18';
  if (years < 30) return '18_29';
  if (years < 40) return '30_39';
  if (years < 50) return '40_49';
  if (years < 60) return '50_59';
  if (years < 70) return '60_69';
  return '70plus';
}

export const SKIN_DETAILS_SIZE =
  SKIN_AGE_BUCKETS.length +
  1 +
  3 +
  SKIN_SITES.length +
  1 +
  2 * SKIN_SYMPTOMS.length +
  SKIN_DURATIONS.length +
  1 +
  7;

/** The details vector, laid out exactly as `encode` in tools/derm-cnn/train_skin_cnn.py. */
export function encodeSkinDetails(details: SkinDetails): Float32Array {
  const vector = new Float32Array(SKIN_DETAILS_SIZE);
  let offset = 0;
  const oneHot = (values: readonly string[], value: string | undefined): void => {
    const index = value === undefined ? -1 : values.indexOf(value);
    vector[offset + (index >= 0 ? index : values.length)] = 1;
    offset += values.length + 1;
  };
  oneHot(SKIN_AGE_BUCKETS, details.age);
  oneHot(['male', 'female'], details.sex);
  const sites = details.sites ?? [];
  for (const site of sites) vector[offset + SKIN_SITES.indexOf(site)] = 1;
  if (sites.length === 0) vector[offset + SKIN_SITES.length] = 1;
  offset += SKIN_SITES.length + 1;
  SKIN_SYMPTOMS.forEach((name, index) => {
    const value = details.symptoms?.[name];
    if (value !== undefined) {
      vector[offset + 2 * index] = 1;
      vector[offset + 2 * index + 1] = value ? 1 : 0;
    }
  });
  offset += 2 * SKIN_SYMPTOMS.length;
  oneHot(SKIN_DURATIONS, details.duration);
  vector[offset + (details.fitzpatrick ? details.fitzpatrick - 1 : 6)] = 1;
  return vector;
}

export interface SkinPrediction {
  readonly classId: string;
  readonly probability: number;
}

export interface SkinAnalysis {
  /** Every class, most likely first; the page shows the first one to three. */
  readonly predictions: readonly SkinPrediction[];
  /** Sum of the malignant classes' probabilities. */
  readonly malignantScore: number;
  /** The malignancy check fired (threshold set for ≥ 95 % sensitivity on validation). */
  readonly malignantFlag: boolean;
  /** The best class is not clearly ahead: show «не уверен». */
  readonly uncertain: boolean;
}

export type SkinModelStatus = 'ready' | 'missing';

export interface SkinModel {
  /** Whether the model files are present (a build without the local weights reports «missing»). */
  status(): Promise<SkinModelStatus>;
  /**
   * Classifies one photo: the square crop the camera window shows (any size; the worker resizes
   * it to the model's input) plus whatever details are known. Re-run with new details to re-rank:
   * it takes tens of milliseconds.
   */
  analyze(photo: Blob, details: SkinDetails): Promise<SkinAnalysis>;
}

export const SKIN_MODEL_URL = 'models/skin/';
