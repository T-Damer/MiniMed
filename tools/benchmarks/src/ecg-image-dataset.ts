// biome-ignore-all lint/complexity/useLiteralKeys: TypeScript requires bracket access for validated unknown records.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ECG_IMAGE_LABELS = [
  'NORM',
  'Acute MI',
  'Old MI',
  'STTC',
  'CD',
  'HYP',
  'PAC',
  'PVC',
  'AFIB/AFL',
  'TACHY',
  'BRADY',
] as const;

export type EcgImageLabel = (typeof ECG_IMAGE_LABELS)[number];

export interface EcgImageSource {
  readonly source_id: string;
  readonly name: string;
  readonly source_url: string;
  readonly revision?: string;
  readonly license: string | null;
  readonly rights_status: string;
  readonly redistribution_allowed: boolean;
}

export interface EcgImageCase {
  readonly case_id: string;
  readonly source_id: string;
  readonly fixture_kind: 'classification' | 'quality-only';
  readonly labels: readonly EcgImageLabel[];
  readonly title: string;
  readonly page_url: string;
  readonly image_url: string;
}

export interface EcgImageDataset {
  readonly schema_version: 1;
  readonly dataset_id: string;
  readonly intended_use: string;
  readonly sources: readonly EcgImageSource[];
  readonly cases: readonly EcgImageCase[];
}

const DATASET_PATH = resolve(import.meta.dirname, '../ecg-image-evaluation.json');
const LABELS = new Set<string>(ECG_IMAGE_LABELS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a string.`);
  return value.trim();
}

function webUrl(value: unknown, field: string): string {
  const url = requiredString(value, field);
  if (new URL(url).protocol !== 'https:') throw new Error(`${field} must use HTTPS.`);
  return url;
}

function parseSource(value: unknown, index: number): EcgImageSource {
  if (!isRecord(value)) throw new Error(`ECG image source ${index + 1} must be an object.`);
  const source = value as Partial<EcgImageSource>;
  if (typeof source.redistribution_allowed !== 'boolean') {
    throw new Error(`ECG image source ${index + 1} must declare redistribution_allowed.`);
  }
  if (source.license !== null && typeof source.license !== 'string') {
    throw new Error(`ECG image source ${index + 1} has an invalid license.`);
  }
  if (source.redistribution_allowed && !source.license?.trim()) {
    throw new Error(`ECG image source ${index + 1} cannot allow redistribution without a license.`);
  }
  const revision = source.revision;
  if (revision !== undefined && (typeof revision !== 'string' || !revision.trim())) {
    throw new Error(`ECG image source ${index + 1} has an invalid revision.`);
  }
  return {
    source_id: requiredString(source.source_id, `sources[${index}].source_id`),
    name: requiredString(source.name, `sources[${index}].name`),
    source_url: webUrl(source.source_url, `sources[${index}].source_url`),
    ...(revision === undefined ? {} : { revision: revision.trim() }),
    license: source.license,
    rights_status: requiredString(source.rights_status, `sources[${index}].rights_status`),
    redistribution_allowed: source.redistribution_allowed,
  };
}

function parseCase(value: unknown, index: number): EcgImageCase {
  if (!isRecord(value)) throw new Error(`ECG image case ${index + 1} must be an object.`);
  const fixture = value as Partial<EcgImageCase>;
  if (fixture.fixture_kind !== 'classification' && fixture.fixture_kind !== 'quality-only') {
    throw new Error(`ECG image case ${index + 1} has an invalid fixture_kind.`);
  }
  if (!Array.isArray(fixture.labels) || !fixture.labels.every((label) => LABELS.has(label))) {
    throw new Error(`ECG image case ${index + 1} has invalid labels.`);
  }
  if (fixture.fixture_kind === 'classification' && fixture.labels.length === 0) {
    throw new Error(`ECG classification case ${index + 1} must have a label.`);
  }
  if (fixture.fixture_kind === 'quality-only' && fixture.labels.length !== 0) {
    throw new Error(`ECG quality-only case ${index + 1} cannot have diagnostic labels.`);
  }
  return {
    case_id: requiredString(fixture.case_id, `cases[${index}].case_id`),
    source_id: requiredString(fixture.source_id, `cases[${index}].source_id`),
    fixture_kind: fixture.fixture_kind,
    labels: fixture.labels as readonly EcgImageLabel[],
    title: requiredString(fixture.title, `cases[${index}].title`),
    page_url: webUrl(fixture.page_url, `cases[${index}].page_url`),
    image_url: webUrl(fixture.image_url, `cases[${index}].image_url`),
  };
}

export function parseEcgImageDataset(value: unknown): EcgImageDataset {
  if (!isRecord(value)) throw new Error('ECG image dataset must be an object.');
  if (value['schema_version'] !== 1) throw new Error('Unsupported ECG image dataset schema.');
  if (!Array.isArray(value['sources']) || !Array.isArray(value['cases'])) {
    throw new Error('ECG image dataset must contain sources and cases.');
  }
  const sources = value['sources'].map(parseSource);
  const cases = value['cases'].map(parseCase);
  if (sources.length === 0 || cases.length === 0) throw new Error('ECG image dataset is empty.');
  const sourceIds = new Set(sources.map((source) => source.source_id));
  if (sourceIds.size !== sources.length) throw new Error('ECG image source IDs must be unique.');
  if (new Set(cases.map((fixture) => fixture.case_id)).size !== cases.length) {
    throw new Error('ECG image case IDs must be unique.');
  }
  if (cases.some((fixture) => !sourceIds.has(fixture.source_id))) {
    throw new Error('ECG image case references an unknown source.');
  }
  return {
    schema_version: 1,
    dataset_id: requiredString(value['dataset_id'], 'dataset_id'),
    intended_use: requiredString(value['intended_use'], 'intended_use'),
    sources,
    cases,
  };
}

export function loadEcgImageDataset(path = DATASET_PATH): EcgImageDataset {
  return parseEcgImageDataset(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
