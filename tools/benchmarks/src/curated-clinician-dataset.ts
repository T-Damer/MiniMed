import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { HardMedicalQuery } from './hard-query-dataset';

const DATASET_PATH = resolve(import.meta.dirname, '../curated-clinician-queries.json');
const STYLES = new Set(['professional', 'colloquial', 'keywords', 'noisy', 'case']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const ANSWERABILITY = new Set(['answerable', 'partial_or_no_answer']);

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseQuery(value: unknown, index: number): HardMedicalQuery {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Curated clinician query ${index + 1} must be an object.`);
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
    !STYLES.has(query.style ?? '') ||
    !DIFFICULTIES.has(query.difficulty ?? '') ||
    !ANSWERABILITY.has(query.answerability ?? '') ||
    query.split !== 'validation' ||
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
    throw new Error(`Curated clinician query ${index + 1} violates the dataset contract.`);
  }
  return query as HardMedicalQuery;
}

export function loadCuratedClinicianQueries(): readonly HardMedicalQuery[] {
  const value: unknown = JSON.parse(readFileSync(DATASET_PATH, 'utf8'));
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Curated clinician dataset must be a non-empty array.');
  }
  const rows = value.map(parseQuery);
  if (new Set(rows.map((row) => row.query_id)).size !== rows.length) {
    throw new Error('Curated clinician query IDs must be unique.');
  }
  if (new Set(rows.map((row) => row.query)).size !== rows.length) {
    throw new Error('Curated clinician query texts must be unique.');
  }
  return rows;
}
