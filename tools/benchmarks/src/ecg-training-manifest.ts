// biome-ignore-all lint/complexity/useLiteralKeys: validated unknown records require bracket access.

import { ECG_IMAGE_LABELS, type EcgImageLabel } from './ecg-image-dataset';

export const ECG_TRAINING_PROFILE = {
  leads: 12,
  layout: '12x1',
  speed_mm_per_s: 50,
  gain_mm_per_mV: 10,
} as const;

export const ECG_TRAINING_AGE_GROUPS = [
  '0–6d',
  '7–30d',
  '1–3mo',
  '3–6mo',
  '6–12mo',
  '1–3y',
  '3–5y',
  '5–8y',
  '8–12y',
  '12–16y',
  '16–17y',
  '18+',
] as const;

export type EcgTrainingCohort = 'adult' | 'pediatric';
export type EcgTrainingInputKind = 'signal' | 'render' | 'real-phone';
export type EcgTrainingSex = 'female' | 'male' | 'intersex' | 'unknown';
export type EcgTrainingSplit = 'train' | 'calibration' | 'validation' | 'test';
export type EcgTrainingProfile = typeof ECG_TRAINING_PROFILE;
export type EcgTrainingAgeGroup = (typeof ECG_TRAINING_AGE_GROUPS)[number];

export interface EcgTrainingSource {
  readonly dataset: string;
  readonly revision: string;
  readonly license: string;
  readonly rights: string;
}

export interface EcgTrainingRecord {
  readonly artifact_sha256?: string;
  readonly id: string;
  readonly base_ecg_id: string;
  readonly patient_id: string;
  readonly source: EcgTrainingSource;
  readonly cohort: EcgTrainingCohort;
  readonly age_days?: number;
  readonly sex?: EcgTrainingSex;
  readonly input_kind: EcgTrainingInputKind;
  readonly profile: EcgTrainingProfile;
  readonly split: EcgTrainingSplit;
  readonly ground_truth_labels: readonly EcgImageLabel[];
  readonly source_label_codes?: readonly string[];
}

export interface EcgTrainingManifest {
  readonly records: readonly EcgTrainingRecord[];
}

export interface EcgTrainingManifestSummary {
  readonly recordCount: number;
  readonly bySplit: Readonly<Record<EcgTrainingSplit, number>>;
  readonly bySource: Readonly<Record<string, number>>;
  readonly byCohort: Readonly<Record<EcgTrainingCohort, number>>;
  readonly byInputKind: Readonly<Record<EcgTrainingInputKind, number>>;
  readonly byAgeGroup: Readonly<Record<EcgTrainingAgeGroup, number>>;
}

const SPLITS = ['train', 'calibration', 'validation', 'test'] as const;
const COHORTS = ['adult', 'pediatric'] as const;
const INPUT_KINDS = ['signal', 'render', 'real-phone'] as const;
const SEXES = ['female', 'male', 'intersex', 'unknown'] as const;
const LABELS = new Set<string>(ECG_IMAGE_LABELS);
// With dates unavailable, 18 years can span five leap days; 6,575 is the first unambiguous adult day.
const AGE_GROUP_CUTOFF_DAYS = {
  sevenDays: 7,
  thirtyOneDays: 31,
  threeMonths: 90,
  sixMonths: 180,
  oneYear: 365,
  threeYears: 1_095,
  fiveYears: 1_825,
  eightYears: 2_920,
  twelveYears: 4_380,
  sixteenYears: 5_840,
  adult: 6_575,
} as const;
export const ECG_TRAINING_ADULT_MIN_AGE_DAYS = AGE_GROUP_CUTOFF_DAYS.adult;
const ADULT_AGE_DAYS = ECG_TRAINING_ADULT_MIN_AGE_DAYS;
const ARTIFACT_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${path} has an unsupported value.`);
  }
  return value as T;
}

function parseSource(value: unknown, path: string): EcgTrainingSource {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  return {
    dataset: requiredString(value['dataset'], `${path}.dataset`),
    revision: requiredString(value['revision'], `${path}.revision`),
    license: requiredString(value['license'], `${path}.license`),
    rights: requiredString(value['rights'], `${path}.rights`),
  };
}

function parseProfile(value: unknown, path: string): EcgTrainingProfile {
  if (
    !isRecord(value) ||
    value['leads'] !== ECG_TRAINING_PROFILE.leads ||
    value['layout'] !== ECG_TRAINING_PROFILE.layout ||
    value['speed_mm_per_s'] !== ECG_TRAINING_PROFILE.speed_mm_per_s ||
    value['gain_mm_per_mV'] !== ECG_TRAINING_PROFILE.gain_mm_per_mV
  ) {
    throw new Error(`${path} must use the fixed 12-lead 12x1 50 mm/s 10 mm/mV profile.`);
  }
  return ECG_TRAINING_PROFILE;
}

function parseAgeDays(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer.`);
  }
  return value;
}

function parseArtifactSha256(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ARTIFACT_SHA256_PATTERN.test(value)) {
    throw new Error(`${path} must be exactly 64 lowercase hexadecimal characters.`);
  }
  return value;
}

function parseSex(value: unknown, path: string): EcgTrainingSex | undefined {
  if (value === undefined) return undefined;
  return enumValue(value, SEXES, path);
}

function parseLabels(value: unknown, path: string): readonly EcgImageLabel[] {
  if (
    !Array.isArray(value) ||
    value.some((label) => typeof label !== 'string' || !LABELS.has(label))
  ) {
    throw new Error(`${path} must contain only ECG image labels.`);
  }
  return value as readonly EcgImageLabel[];
}

function parseSourceLabelCodes(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((code) => typeof code !== 'string' || code.trim().length === 0)
  ) {
    throw new Error(`${path} must contain at least one non-empty source label code.`);
  }
  const codes = value.map((code) => (code as string).trim());
  if (new Set(codes).size !== codes.length) throw new Error(`${path} must not contain duplicates.`);
  return codes;
}

function parseRecord(value: unknown, index: number): EcgTrainingRecord {
  const path = `records[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);

  const cohort = enumValue(value['cohort'], COHORTS, `${path}.cohort`);
  const ageDays = parseAgeDays(value['age_days'], `${path}.age_days`);
  const artifactSha256 = parseArtifactSha256(value['artifact_sha256'], `${path}.artifact_sha256`);
  if (cohort === 'pediatric' && ageDays === undefined) {
    throw new Error(`${path}.age_days is required for pediatric records.`);
  }
  if (cohort === 'pediatric' && ageDays !== undefined && ageDays >= ADULT_AGE_DAYS) {
    throw new Error(`${path}.age_days is outside the pediatric cohort.`);
  }
  if (cohort === 'adult' && ageDays !== undefined && ageDays < ADULT_AGE_DAYS) {
    throw new Error(`${path}.age_days is outside the adult cohort.`);
  }

  const inputKind = enumValue(value['input_kind'], INPUT_KINDS, `${path}.input_kind`);
  const split = enumValue(value['split'], SPLITS, `${path}.split`);
  if (inputKind === 'real-phone' && split !== 'test') {
    throw new Error(`${path}.input_kind real-phone is only allowed in the test split.`);
  }

  const sex = parseSex(value['sex'], `${path}.sex`);
  const groundTruthLabels = parseLabels(
    value['ground_truth_labels'],
    `${path}.ground_truth_labels`,
  );
  const sourceLabelCodes = parseSourceLabelCodes(
    value['source_label_codes'],
    `${path}.source_label_codes`,
  );
  if (cohort === 'adult' && groundTruthLabels.length === 0) {
    throw new Error(`${path}.ground_truth_labels is required for adult records.`);
  }
  if (cohort === 'pediatric' && groundTruthLabels.length > 0) {
    throw new Error(`${path} cannot map pediatric records to adult ECG image labels.`);
  }
  if (cohort === 'pediatric' && sourceLabelCodes === undefined) {
    throw new Error(`${path}.source_label_codes is required for pediatric records.`);
  }
  return {
    ...(artifactSha256 === undefined ? {} : { artifact_sha256: artifactSha256 }),
    id: requiredString(value['id'], `${path}.id`),
    base_ecg_id: requiredString(value['base_ecg_id'], `${path}.base_ecg_id`),
    patient_id: requiredString(value['patient_id'], `${path}.patient_id`),
    source: parseSource(value['source'], `${path}.source`),
    cohort,
    ...(ageDays === undefined ? {} : { age_days: ageDays }),
    ...(sex === undefined ? {} : { sex }),
    input_kind: inputKind,
    profile: parseProfile(value['profile'], `${path}.profile`),
    split,
    ground_truth_labels: groundTruthLabels,
    ...(sourceLabelCodes === undefined ? {} : { source_label_codes: sourceLabelCodes }),
  };
}

function assertSplitDisjoint(
  records: readonly EcgTrainingRecord[],
  field: 'patient_id' | 'base_ecg_id',
): void {
  const splitByValue = new Map<string, EcgTrainingSplit>();
  for (const record of records) {
    const value = record[field];
    const previousSplit = splitByValue.get(value);
    if (previousSplit !== undefined && previousSplit !== record.split) {
      throw new Error(
        `${field} ${JSON.stringify(value)} appears in both ${previousSplit} and ${record.split} splits.`,
      );
    }
    splitByValue.set(value, record.split);
  }
}

export function validateEcgTrainingManifest(value: unknown): EcgTrainingManifest {
  if (!isRecord(value) || !Array.isArray(value['records'])) {
    throw new Error('ECG training manifest must contain a records array.');
  }
  if (value['records'].length === 0) throw new Error('ECG training manifest is empty.');

  const records = value['records'].map(parseRecord);
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error('ECG training record IDs must be unique.');
  }
  assertSplitDisjoint(records, 'patient_id');
  assertSplitDisjoint(records, 'base_ecg_id');
  return { records };
}

export const parseEcgTrainingManifest = validateEcgTrainingManifest;

const UNPINNED_ADULT_REVISIONS = new Set(['head', 'latest', 'main', 'master', 'unknown']);

/**
 * Validates the stronger, adult-only manifest contract required before GPU training.
 * The general validator intentionally remains permissive for source-specific manifests.
 */
export function validateAdultEcgGpuTrainingManifest(value: unknown): EcgTrainingManifest {
  const manifest = validateEcgTrainingManifest(value);
  const adultRecords = manifest.records.filter((record) => record.cohort === 'adult');

  const missingSplits = SPLITS.filter(
    (split) => !adultRecords.some((record) => record.split === split),
  );
  if (missingSplits.length > 0) {
    throw new Error(`Adult GPU manifest requires non-empty splits: ${missingSplits.join(', ')}.`);
  }
  if (!adultRecords.some((record) => record.input_kind === 'signal' && record.split === 'train')) {
    throw new Error('Adult GPU manifest requires at least one adult signal train record.');
  }
  if (!adultRecords.some((record) => record.input_kind === 'render' && record.split !== 'test')) {
    throw new Error('Adult GPU manifest requires an adult render record outside test.');
  }
  if (
    !adultRecords.some((record) => record.input_kind === 'real-phone' && record.split === 'test')
  ) {
    throw new Error('Adult GPU manifest requires an adult real-phone record in test.');
  }

  const unpinnedRevisionRecords = adultRecords.filter((record) =>
    UNPINNED_ADULT_REVISIONS.has(record.source.revision.toLowerCase()),
  );
  if (unpinnedRevisionRecords.length > 0) {
    throw new Error(
      `Adult GPU records require pinned source.revision; rejected records: ${unpinnedRevisionRecords
        .map((record) => record.id)
        .sort(compareStrings)
        .join(', ')}.`,
    );
  }

  const missingArtifactRecords = adultRecords.filter(
    (record) =>
      (record.input_kind === 'render' || record.input_kind === 'real-phone') &&
      record.artifact_sha256 === undefined,
  );
  if (missingArtifactRecords.length > 0) {
    throw new Error(
      `Adult GPU render and real-phone records require artifact_sha256: ${missingArtifactRecords
        .map((record) => record.id)
        .sort(compareStrings)
        .join(', ')}.`,
    );
  }

  const nonPhoneLabels = new Set<EcgImageLabel>();
  for (const record of adultRecords) {
    if (record.input_kind !== 'real-phone') {
      for (const label of record.ground_truth_labels) nonPhoneLabels.add(label);
    }
  }
  const phoneLabels = new Set<EcgImageLabel>();
  for (const record of adultRecords) {
    if (record.input_kind === 'real-phone' && record.split === 'test') {
      for (const label of record.ground_truth_labels) phoneLabels.add(label);
    }
  }
  const missingLabels = [...nonPhoneLabels]
    .filter((label) => !phoneLabels.has(label))
    .sort(compareStrings);
  if (missingLabels.length > 0) {
    throw new Error(`Adult GPU real-phone test labels are missing: ${missingLabels.join(', ')}.`);
  }

  return manifest;
}

function ageGroup(ageDays: number | undefined): EcgTrainingAgeGroup {
  if (ageDays === undefined) return '18+';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.sevenDays) return '0–6d';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.thirtyOneDays) return '7–30d';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.threeMonths) return '1–3mo';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.sixMonths) return '3–6mo';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.oneYear) return '6–12mo';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.threeYears) return '1–3y';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.fiveYears) return '3–5y';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.eightYears) return '5–8y';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.twelveYears) return '8–12y';
  if (ageDays < AGE_GROUP_CUTOFF_DAYS.sixteenYears) return '12–16y';
  if (ageDays < ADULT_AGE_DAYS) return '16–17y';
  return '18+';
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedCountRecord(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => compareStrings(left, right)),
  );
}

export function summarizeEcgTrainingManifest(
  manifest: EcgTrainingManifest,
): EcgTrainingManifestSummary {
  const bySplit: Record<EcgTrainingSplit, number> = {
    train: 0,
    calibration: 0,
    validation: 0,
    test: 0,
  };
  const bySource = new Map<string, number>();
  const byCohort: Record<EcgTrainingCohort, number> = { adult: 0, pediatric: 0 };
  const byInputKind: Record<EcgTrainingInputKind, number> = {
    signal: 0,
    render: 0,
    'real-phone': 0,
  };
  const byAgeGroup: Record<EcgTrainingAgeGroup, number> = {
    '0–6d': 0,
    '7–30d': 0,
    '1–3mo': 0,
    '3–6mo': 0,
    '6–12mo': 0,
    '1–3y': 0,
    '3–5y': 0,
    '5–8y': 0,
    '8–12y': 0,
    '12–16y': 0,
    '16–17y': 0,
    '18+': 0,
  };

  for (const record of manifest.records) {
    bySplit[record.split] += 1;
    bySource.set(record.source.dataset, (bySource.get(record.source.dataset) ?? 0) + 1);
    byCohort[record.cohort] += 1;
    byInputKind[record.input_kind] += 1;
    byAgeGroup[ageGroup(record.age_days)] += 1;
  }

  return {
    recordCount: manifest.records.length,
    bySplit,
    bySource: sortedCountRecord(bySource),
    byCohort,
    byInputKind,
    byAgeGroup,
  };
}
