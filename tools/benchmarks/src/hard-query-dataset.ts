import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

export type HardQuerySplit = 'dev' | 'validation' | 'hidden_test';
export type HardQueryStyle = 'professional' | 'colloquial' | 'keywords' | 'noisy' | 'case';
export type HardQueryAnswerability = 'answerable' | 'partial_or_no_answer';

export interface HardQueryGrading {
  readonly required_gain: number;
  readonly acceptable_gain: number;
  readonly irrelevant_gain: number;
  readonly forbidden_gain: number;
}

export interface HardMedicalQuery {
  readonly query_id: string;
  readonly scenario_id: string;
  readonly query: string;
  readonly language: 'ru';
  readonly domain: 'medicine';
  readonly specialty: string;
  readonly age_group: string;
  readonly intent: string;
  readonly style: HardQueryStyle;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly answerability: HardQueryAnswerability;
  readonly split: HardQuerySplit;
  readonly required_entities: readonly string[];
  readonly acceptable_entities: readonly string[];
  readonly forbidden_or_dangerous: readonly string[];
  readonly expected_sections: readonly string[];
  readonly expected_terms: readonly string[];
  readonly grading: HardQueryGrading;
}

interface HardQueryManifest {
  readonly id: string;
  readonly version: number;
  readonly encoding: 'gzip+base64';
  readonly queryCount: number;
  readonly scenarioCount: number;
  readonly sourceSha256: string;
  readonly compressedSha256: string;
  readonly splits: Readonly<Record<HardQuerySplit, number>>;
  readonly styles: Readonly<Record<HardQueryStyle, number>>;
  readonly partialOrNoAnswerCount: number;
}

export interface LoadHardMedicalQueriesOptions {
  readonly split?: HardQuerySplit | 'all';
}

const FIXTURE_ROOT = resolve(import.meta.dirname, '../fixtures');
const DATASET_PARTS_ROOT = resolve(FIXTURE_ROOT, 'hard-medical-queries-1500.parts');
const DATASET_PART_NAMES = [
  'part-00.b64',
  'part-01.b64',
  'part-02.b64',
  'part-03.b64',
  'part-04.b64',
  'part-05.b64',
  'part-06.b64',
  'part-07.b64',
  'part-08.b64',
] as const;
const MANIFEST_PATH = resolve(FIXTURE_ROOT, 'hard-medical-queries-1500.manifest.json');

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseManifest(value: unknown): HardQueryManifest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Hard-query manifest must be an object.');
  }
  const manifest = value as Partial<HardQueryManifest>;
  if (
    typeof manifest.id !== 'string' ||
    typeof manifest.version !== 'number' ||
    manifest.encoding !== 'gzip+base64' ||
    typeof manifest.queryCount !== 'number' ||
    typeof manifest.scenarioCount !== 'number' ||
    typeof manifest.sourceSha256 !== 'string' ||
    typeof manifest.compressedSha256 !== 'string' ||
    typeof manifest.partialOrNoAnswerCount !== 'number' ||
    typeof manifest.splits !== 'object' ||
    manifest.splits === null ||
    typeof manifest.styles !== 'object' ||
    manifest.styles === null
  ) {
    throw new Error('Hard-query manifest is incomplete.');
  }
  return manifest as HardQueryManifest;
}

function parseQuery(value: unknown, line: number): HardMedicalQuery {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Hard-query line ${line} must be an object.`);
  }
  const query = value as Partial<HardMedicalQuery>;
  if (
    typeof query.query_id !== 'string' ||
    typeof query.scenario_id !== 'string' ||
    typeof query.query !== 'string' ||
    query.language !== 'ru' ||
    query.domain !== 'medicine' ||
    typeof query.specialty !== 'string' ||
    typeof query.age_group !== 'string' ||
    typeof query.intent !== 'string' ||
    !['professional', 'colloquial', 'keywords', 'noisy', 'case'].includes(query.style ?? '') ||
    !['easy', 'medium', 'hard'].includes(query.difficulty ?? '') ||
    !['answerable', 'partial_or_no_answer'].includes(query.answerability ?? '') ||
    !['dev', 'validation', 'hidden_test'].includes(query.split ?? '') ||
    !isStringArray(query.required_entities) ||
    !isStringArray(query.acceptable_entities) ||
    !isStringArray(query.forbidden_or_dangerous) ||
    !isStringArray(query.expected_sections) ||
    !isStringArray(query.expected_terms) ||
    typeof query.grading !== 'object' ||
    query.grading === null ||
    typeof query.grading.required_gain !== 'number' ||
    typeof query.grading.acceptable_gain !== 'number' ||
    typeof query.grading.irrelevant_gain !== 'number' ||
    typeof query.grading.forbidden_gain !== 'number'
  ) {
    throw new Error(`Hard-query line ${line} does not satisfy the dataset contract.`);
  }
  return query as HardMedicalQuery;
}

function countBy<T extends string>(values: readonly T[]): Readonly<Record<T, number>> {
  const counts = {} as Record<T, number>;
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function loadHardQueryManifest(): HardQueryManifest {
  return parseManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown);
}

export function loadHardMedicalQueries(
  options: LoadHardMedicalQueriesOptions = {},
): readonly HardMedicalQuery[] {
  const manifest = loadHardQueryManifest();
  const encoded = DATASET_PART_NAMES.map((name) =>
    readFileSync(resolve(DATASET_PARTS_ROOT, name), 'utf8'),
  )
    .join('')
    .replace(/\s+/gu, '');
  const compressed = Buffer.from(encoded, 'base64');
  if (sha256(compressed) !== manifest.compressedSha256) {
    throw new Error('Hard-query compressed fixture checksum mismatch.');
  }
  const source = gunzipSync(compressed);
  if (sha256(source) !== manifest.sourceSha256) {
    throw new Error('Hard-query source fixture checksum mismatch.');
  }

  const rows = source
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => parseQuery(JSON.parse(line) as unknown, index + 1));

  const queryIds = new Set(rows.map((row) => row.query_id));
  const queryTexts = new Set(rows.map((row) => row.query));
  const scenarios = new Set(rows.map((row) => row.scenario_id));
  if (
    rows.length !== manifest.queryCount ||
    queryIds.size !== rows.length ||
    queryTexts.size !== rows.length
  ) {
    throw new Error(
      'Hard-query fixture must contain the declared number of unique ids and query texts.',
    );
  }
  if (scenarios.size !== manifest.scenarioCount) {
    throw new Error('Hard-query scenario count does not match the manifest.');
  }

  const splitCounts = countBy(rows.map((row) => row.split));
  const styleCounts = countBy(rows.map((row) => row.style));
  for (const split of ['dev', 'validation', 'hidden_test'] as const) {
    if (splitCounts[split] !== manifest.splits[split]) {
      throw new Error(`Hard-query split ${split} does not match the manifest.`);
    }
  }
  for (const style of ['professional', 'colloquial', 'keywords', 'noisy', 'case'] as const) {
    if (styleCounts[style] !== manifest.styles[style]) {
      throw new Error(`Hard-query style ${style} does not match the manifest.`);
    }
  }
  if (
    rows.filter((row) => row.answerability === 'partial_or_no_answer').length !==
    manifest.partialOrNoAnswerCount
  ) {
    throw new Error('Hard-query no-answer count does not match the manifest.');
  }

  const split = options.split ?? 'all';
  return split === 'all' ? rows : rows.filter((row) => row.split === split);
}
