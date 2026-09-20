import { readFileSync } from 'node:fs';

import type { SearchResultGroup } from '@localmed/contracts';
import { findNormalizedPhraseIndex, normalizeSurfaceText } from '@localmed/search-lexical';

export type SearchQualityGoal = 'diagnosis-navigation' | 'diagnostics' | 'treatment' | 'routing';
export type SearchQualityAnswerability = 'focused' | 'ambiguous';
export type SearchQualityOrigin =
  | 'manual-challenge'
  | 'real-clinician-query'
  | 'legacy-pilot-training';

export interface SearchQualityTarget {
  readonly documentId: string;
  readonly grade: 1 | 2 | 3;
  readonly sectionTypes: readonly string[];
}

export interface SearchQualityFixture {
  readonly id: string;
  readonly query: string;
  readonly origin: SearchQualityOrigin;
  readonly family: string;
  readonly goal: SearchQualityGoal;
  readonly answerability: SearchQualityAnswerability;
  readonly relevance: readonly SearchQualityTarget[];
  readonly leakageTerms: readonly string[];
  readonly forbiddenDocumentIds: readonly string[];
  readonly rationale: string;
}

export interface SearchQualityEvaluation {
  readonly id: string;
  readonly profile: string;
  readonly family: string;
  readonly goal: SearchQualityGoal;
  readonly answerability: SearchQualityAnswerability;
  readonly top1DocumentId: string | null;
  readonly top5DocumentIds: readonly string[];
  readonly top20DocumentIds: readonly string[];
  readonly top40DocumentIds: readonly string[];
  readonly top1MaxGrade: boolean;
  readonly hitAt5: boolean;
  readonly relevantRecallAt20: number;
  readonly relevantRecallAt40: number;
  readonly weightedRecallAt20: number;
  readonly weightedRecallAt40: number;
  readonly ndcgAt5: number;
  readonly ndcgAt10: number;
  readonly mrrAt20: number;
  readonly sectionHitAt5: boolean;
  readonly forbiddenAt5: boolean;
  readonly elapsedMs: number;
  readonly modeUsed: string;
}

const GOALS = new Set<SearchQualityGoal>([
  'diagnosis-navigation',
  'diagnostics',
  'treatment',
  'routing',
]);
const ANSWERABILITY = new Set<SearchQualityAnswerability>(['focused', 'ambiguous']);
const ORIGINS = new Set<SearchQualityOrigin>([
  'manual-challenge',
  'real-clinician-query',
  'legacy-pilot-training',
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string.`);
  return value.trim();
}

function stringArray(value: unknown, label: string, allowEmpty = false): readonly string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    !value.every((item) => typeof item === 'string' && item.trim().length > 0)
  ) {
    throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} string array.`);
  }
  return value.map((item) => item.trim());
}

function parseTarget(value: unknown, label: string): SearchQualityTarget {
  const row = record(value, label);
  const grade = row.grade;
  if (grade !== 1 && grade !== 2 && grade !== 3) {
    throw new Error(`${label}.grade must be 1, 2, or 3.`);
  }
  return {
    documentId: stringValue(row.documentId, `${label}.documentId`),
    grade,
    sectionTypes: stringArray(row.sectionTypes, `${label}.sectionTypes`),
  };
}

function validateLeakage(fixture: SearchQualityFixture): void {
  const normalizedQuery = normalizeSurfaceText(fixture.query);
  for (const term of fixture.leakageTerms) {
    const normalizedTerm = normalizeSurfaceText(term);
    if (normalizedTerm.length < 2) {
      throw new Error(
        `${fixture.id}: leakage terms must contain at least two normalized characters.`,
      );
    }
    if (findNormalizedPhraseIndex(normalizedQuery, normalizedTerm) >= 0) {
      throw new Error(`${fixture.id}: query leaks answer term "${term}".`);
    }
  }
}

export function parseSearchQualityFixtures(value: unknown): readonly SearchQualityFixture[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Search-quality fixture must be a non-empty array.');
  }

  const ids = new Set<string>();
  const fixtures = value.map((item, index): SearchQualityFixture => {
    const row = record(item, `fixture ${index}`);
    const id = stringValue(row.id, `fixture ${index}.id`);
    if (ids.has(id)) throw new Error(`Duplicate search-quality fixture id: ${id}`);
    ids.add(id);

    const origin = row.origin;
    if (!ORIGINS.has(origin as SearchQualityOrigin)) {
      throw new Error(`${id}: unsupported origin.`);
    }
    const goal = row.goal;
    if (!GOALS.has(goal as SearchQualityGoal)) {
      throw new Error(`${id}: unsupported goal.`);
    }
    const answerability = row.answerability;
    if (!ANSWERABILITY.has(answerability as SearchQualityAnswerability)) {
      throw new Error(`${id}: unsupported answerability.`);
    }
    if (!Array.isArray(row.relevance) || row.relevance.length === 0) {
      throw new Error(`${id}: relevance must be non-empty.`);
    }
    const relevance = row.relevance.map((target, targetIndex) =>
      parseTarget(target, `${id}.relevance[${targetIndex}]`),
    );
    const relevantIds = new Set(relevance.map((target) => target.documentId));
    if (relevantIds.size !== relevance.length) {
      throw new Error(`${id}: relevance document ids must be unique.`);
    }
    if (answerability === 'ambiguous' && relevance.length < 2) {
      throw new Error(`${id}: ambiguous cases require at least two relevant documents.`);
    }
    const maxGrade = Math.max(...relevance.map((target) => target.grade));
    if (maxGrade < 2) {
      throw new Error(`${id}: at least one relevance target must have grade 2 or 3.`);
    }

    const forbiddenDocumentIds = stringArray(
      row.forbiddenDocumentIds ?? [],
      `${id}.forbiddenDocumentIds`,
      true,
    );
    if (forbiddenDocumentIds.some((documentId) => relevantIds.has(documentId))) {
      throw new Error(`${id}: a relevant document cannot also be forbidden.`);
    }

    const fixture: SearchQualityFixture = {
      id,
      query: stringValue(row.query, `${id}.query`),
      origin: origin as SearchQualityOrigin,
      family: stringValue(row.family, `${id}.family`),
      goal: goal as SearchQualityGoal,
      answerability: answerability as SearchQualityAnswerability,
      relevance,
      leakageTerms: stringArray(row.leakageTerms, `${id}.leakageTerms`),
      forbiddenDocumentIds,
      rationale: stringValue(row.rationale, `${id}.rationale`),
    };
    validateLeakage(fixture);
    return fixture;
  });

  return fixtures;
}

export function loadSearchQualityFixtures(path: string): readonly SearchQualityFixture[] {
  return parseSearchQualityFixtures(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

function targetGrade(fixture: SearchQualityFixture, documentId: string): number {
  return fixture.relevance.find((target) => target.documentId === documentId)?.grade ?? 0;
}

function dcg(grades: readonly number[]): number {
  return grades.reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

function ndcg(
  fixture: SearchQualityFixture,
  documentIds: readonly string[],
  limit: number,
): number {
  const actual = dcg(
    documentIds.slice(0, limit).map((documentId) => targetGrade(fixture, documentId)),
  );
  const idealGrades = fixture.relevance
    .map((target) => target.grade)
    .toSorted((left, right) => right - left)
    .slice(0, limit);
  const ideal = dcg(idealGrades);
  return ideal === 0 ? 0 : actual / ideal;
}

function recallAt(
  fixture: SearchQualityFixture,
  documentIds: readonly string[],
  limit: number,
  weighted: boolean,
): number {
  const selected = new Set(documentIds.slice(0, limit));
  const numerator = fixture.relevance.reduce(
    (sum, target) =>
      sum + (selected.has(target.documentId) ? (weighted ? target.grade : 1) : 0),
    0,
  );
  const denominator = fixture.relevance.reduce(
    (sum, target) => sum + (weighted ? target.grade : 1),
    0,
  );
  return denominator === 0 ? 0 : numerator / denominator;
}

function sectionHitAt5(
  fixture: SearchQualityFixture,
  groups: readonly SearchResultGroup[],
): boolean {
  return groups.slice(0, 5).some((group) => {
    const target = fixture.relevance.find((item) => item.documentId === group.documentId);
    return (
      target !== undefined &&
      group.results.some(
        (result) => result.sectionType !== null && target.sectionTypes.includes(result.sectionType),
      )
    );
  });
}

export function evaluateSearchQuality(
  fixture: SearchQualityFixture,
  groups: readonly SearchResultGroup[],
  profile: string,
  elapsedMs: number,
  modeUsed: string,
): SearchQualityEvaluation {
  const documentIds = groups.map((group) => group.documentId);
  const firstRelevantIndex = documentIds.findIndex(
    (documentId) => targetGrade(fixture, documentId) > 0,
  );
  const maxGrade = Math.max(...fixture.relevance.map((target) => target.grade));
  return {
    id: fixture.id,
    profile,
    family: fixture.family,
    goal: fixture.goal,
    answerability: fixture.answerability,
    top1DocumentId: documentIds[0] ?? null,
    top5DocumentIds: documentIds.slice(0, 5),
    top20DocumentIds: documentIds.slice(0, 20),
    top40DocumentIds: documentIds.slice(0, 40),
    top1MaxGrade: targetGrade(fixture, documentIds[0] ?? '') === maxGrade,
    hitAt5: firstRelevantIndex >= 0 && firstRelevantIndex < 5,
    relevantRecallAt20: recallAt(fixture, documentIds, 20, false),
    relevantRecallAt40: recallAt(fixture, documentIds, 40, false),
    weightedRecallAt20: recallAt(fixture, documentIds, 20, true),
    weightedRecallAt40: recallAt(fixture, documentIds, 40, true),
    ndcgAt5: ndcg(fixture, documentIds, 5),
    ndcgAt10: ndcg(fixture, documentIds, 10),
    mrrAt20: firstRelevantIndex >= 0 && firstRelevantIndex < 20 ? 1 / (firstRelevantIndex + 1) : 0,
    sectionHitAt5: sectionHitAt5(fixture, groups),
    forbiddenAt5: documentIds
      .slice(0, 5)
      .some((documentId) => fixture.forbiddenDocumentIds.includes(documentId)),
    elapsedMs,
    modeUsed,
  };
}

export function aggregateSearchQuality(rows: readonly SearchQualityEvaluation[]) {
  if (rows.length === 0) {
    return {
      cases: 0,
      top1MaxGrade: 0,
      hitAt5: 0,
      relevantRecallAt20: 0,
      relevantRecallAt40: 0,
      weightedRecallAt20: 0,
      weightedRecallAt40: 0,
      ndcgAt5: 0,
      ndcgAt10: 0,
      mrrAt20: 0,
      sectionHitAt5: 0,
      forbiddenRateAt5: 0,
      p50Ms: 0,
      p95Ms: 0,
    };
  }
  const mean = (selector: (row: SearchQualityEvaluation) => number) =>
    rows.reduce((sum, row) => sum + selector(row), 0) / rows.length;
  const timings = rows.map((row) => row.elapsedMs).toSorted((left, right) => left - right);
  const percentile = (p: number) =>
    timings[Math.min(timings.length - 1, Math.floor(timings.length * p))] ?? 0;
  return {
    cases: rows.length,
    top1MaxGrade: mean((row) => Number(row.top1MaxGrade)),
    hitAt5: mean((row) => Number(row.hitAt5)),
    relevantRecallAt20: mean((row) => row.relevantRecallAt20),
    relevantRecallAt40: mean((row) => row.relevantRecallAt40),
    weightedRecallAt20: mean((row) => row.weightedRecallAt20),
    weightedRecallAt40: mean((row) => row.weightedRecallAt40),
    ndcgAt5: mean((row) => row.ndcgAt5),
    ndcgAt10: mean((row) => row.ndcgAt10),
    mrrAt20: mean((row) => row.mrrAt20),
    sectionHitAt5: mean((row) => Number(row.sectionHitAt5)),
    forbiddenRateAt5: mean((row) => Number(row.forbiddenAt5)),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}
