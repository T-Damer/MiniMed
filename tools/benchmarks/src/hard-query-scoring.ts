import type { SearchResultGroup } from '@localmed/contracts';

import type { HardMedicalQuery } from './hard-query-dataset';

export interface HardQueryEvaluation {
  readonly queryId: string;
  readonly scenarioId: string;
  readonly split: HardMedicalQuery['split'];
  readonly style: HardMedicalQuery['style'];
  readonly intent: string;
  readonly specialty: string;
  readonly requiredRank: number | null;
  readonly acceptableRank: number | null;
  readonly requiredAt1: boolean;
  readonly requiredAt3: boolean;
  readonly requiredAt5: boolean;
  readonly acceptableOrRequiredAt5: boolean;
  readonly expectedSectionAt5: boolean;
  readonly forbiddenAt5: boolean;
  readonly reciprocalRank: number;
  readonly retrievedNdcgAt5: number;
  readonly elapsedMs: number;
  readonly topDocumentIds: readonly string[];
}

export interface HardBenchmarkAggregate {
  readonly queryCount: number;
  readonly recallAt1: number;
  readonly recallAt3: number;
  readonly recallAt5: number;
  readonly acceptableOrRequiredRecallAt5: number;
  readonly mrrAt5: number;
  readonly retrievedNdcgAt5: number;
  readonly expectedSectionRecallAt5: number;
  readonly forbiddenRateAt5: number;
  readonly latencyMs: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => {
    const normalizedNeedle = normalize(needle);
    return normalizedNeedle.length > 0 && haystack.includes(normalizedNeedle);
  });
}

function resultText(group: SearchResultGroup): string {
  return normalize(
    [
      group.title,
      ...group.results.flatMap((result) => [
        result.title,
        result.sectionPath.join(' '),
        result.snippet,
        result.matchedTerms.join(' '),
      ]),
    ].join(' '),
  );
}

function firstMatchingRank(
  groups: readonly SearchResultGroup[],
  needles: readonly string[],
  limit: number,
): number | null {
  const index = groups
    .slice(0, limit)
    .findIndex((group) => includesAny(resultText(group), needles));
  return index < 0 ? null : index + 1;
}

function dcg(gains: readonly number[]): number {
  return gains.reduce(
    (total, gain, index) => total + (2 ** Math.max(gain, 0) - 1) / Math.log2(index + 2),
    0,
  );
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

export function evaluateHardQuery(
  fixture: HardMedicalQuery,
  groups: readonly SearchResultGroup[],
  elapsedMs: number,
): HardQueryEvaluation {
  const top5 = groups.slice(0, 5);
  const requiredRank = firstMatchingRank(groups, fixture.required_entities, 5);
  const acceptableRank = firstMatchingRank(groups, fixture.acceptable_entities, 5);
  const expectedSections = fixture.expected_sections.map((value) => value.replaceAll('_', '-'));
  const expectedSectionAt5 = top5.some((group) =>
    group.results.some(
      (result) => result.sectionType !== null && expectedSections.includes(result.sectionType),
    ),
  );
  const forbiddenAt5 = top5.some((group) =>
    includesAny(resultText(group), fixture.forbidden_or_dangerous),
  );
  const gains = top5.map((group) => {
    const text = resultText(group);
    if (includesAny(text, fixture.forbidden_or_dangerous)) return fixture.grading.forbidden_gain;
    if (includesAny(text, fixture.required_entities)) return fixture.grading.required_gain;
    if (includesAny(text, fixture.acceptable_entities)) return fixture.grading.acceptable_gain;
    return fixture.grading.irrelevant_gain;
  });
  const ideal = gains.toSorted((left, right) => right - left);
  const idealDcg = dcg(ideal);

  return {
    queryId: fixture.query_id,
    scenarioId: fixture.scenario_id,
    split: fixture.split,
    style: fixture.style,
    intent: fixture.intent,
    specialty: fixture.specialty,
    requiredRank,
    acceptableRank,
    requiredAt1: requiredRank === 1,
    requiredAt3: requiredRank !== null && requiredRank <= 3,
    requiredAt5: requiredRank !== null,
    acceptableOrRequiredAt5: requiredRank !== null || acceptableRank !== null,
    expectedSectionAt5,
    forbiddenAt5,
    reciprocalRank: requiredRank === null ? 0 : 1 / requiredRank,
    retrievedNdcgAt5: idealDcg === 0 ? 0 : dcg(gains) / idealDcg,
    elapsedMs,
    topDocumentIds: top5.map((group) => group.documentId),
  };
}

export function aggregateHardQueryEvaluations(
  rows: readonly HardQueryEvaluation[],
): HardBenchmarkAggregate {
  const elapsed = rows.map((row) => row.elapsedMs);
  return {
    queryCount: rows.length,
    recallAt1: mean(rows.map((row) => Number(row.requiredAt1))),
    recallAt3: mean(rows.map((row) => Number(row.requiredAt3))),
    recallAt5: mean(rows.map((row) => Number(row.requiredAt5))),
    acceptableOrRequiredRecallAt5: mean(rows.map((row) => Number(row.acceptableOrRequiredAt5))),
    mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
    retrievedNdcgAt5: mean(rows.map((row) => row.retrievedNdcgAt5)),
    expectedSectionRecallAt5: mean(rows.map((row) => Number(row.expectedSectionAt5))),
    forbiddenRateAt5: mean(rows.map((row) => Number(row.forbiddenAt5))),
    latencyMs: {
      p50: percentile(elapsed, 50),
      p95: percentile(elapsed, 95),
      p99: percentile(elapsed, 99),
    },
  };
}
