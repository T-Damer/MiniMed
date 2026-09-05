import { expect, it } from 'vitest';
import { summarizeRuntimeRetrieval } from './runtime-retrieval-scoring';

it('keeps negative-query checks outside the retrieval denominator and exposes unresolved downloads', () => {
  expect(
    summarizeRuntimeRetrieval([
      { edition: 'core-only', rank: 2, checks: { 'recall@5': true, downloadTarget: false } },
      { edition: 'core-only', rank: null, checks: { 'recall@5': false } },
      { edition: 'core-only', rank: null, checks: { forbiddenTargetsAbsent: true } },
    ])['core-only'],
  ).toEqual({
    evaluated: 3,
    retrievalDenominator: 2,
    recallAt5: 0.5,
    mrrAt5: 0.25,
    contextErrors: 0,
    coverage: { local: 0, discovery: 0, absent: 0 },
    outcomes: { 'local-found': 0, 'discovery-found': 0, miss: 0, absent: 0 },
    coveredRecallAt5: null,
    downloadCheckDenominator: 1,
    unverifiedDownloadQueries: 1,
    failedQueries: 2,
  });
});

it('separates absent corpus from misses and scores only the first five UI results', () => {
  const summary = summarizeRuntimeRetrieval([
    {
      edition: 'installed',
      rank: 6,
      coverage: 'local',
      outcome: 'miss',
      checks: { 'recall@5': false },
    },
    {
      edition: 'installed',
      rank: null,
      coverage: 'absent',
      outcome: 'absent',
      checks: { 'recall@5': false },
    },
    {
      edition: 'installed',
      rank: 1,
      coverage: 'discovery',
      outcome: 'discovery-found',
      checks: { 'recall@5': true },
    },
  ])['installed'];
  expect(summary?.recallAt5).toBe(1 / 3);
  expect(summary?.mrrAt5).toBe(1 / 3);
  expect(summary?.coveredRecallAt5).toBe(0.5);
  expect(summary?.failedQueries).toBe(1);
  expect(summary?.coverage).toEqual({ local: 1, discovery: 1, absent: 1 });
});
