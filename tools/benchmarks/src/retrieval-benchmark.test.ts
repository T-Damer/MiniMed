import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  aggregateExact,
  aggregateMkb,
  aggregateRecommendations,
  bestRelation,
  icdRelation,
  loadRetrievalBenchmark,
  normalizeIcdCode,
  parseRetrievalBenchmark,
  type RetrievalQuery,
  scoreQuery,
} from './retrieval-benchmark';

const source = {
  id: 'rumedprime',
  name: 'RuMedPrimeData',
  url: 'https://zenodo.org/records/5765873',
  licence: 'CC-BY-3.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
  attribution: 'Starovoytova et al.',
  redistributable: true,
};

const query = (overrides: Partial<RetrievalQuery> = {}): RetrievalQuery => ({
  id: 'q1',
  query: 'изжога, отрыжка',
  source: 'rumedprime',
  sourceRecordId: 'qe48681b',
  split: 'dev',
  style: 'complaint',
  machineTranslated: false,
  goldCodes: ['K21.0'],
  goldNames: [],
  relevant: [
    { documentId: 'kr.rf.100_1', grade: 3, kind: 'clinical-recommendation' },
    { documentId: 'rls.mkb.node.k21-0', grade: 3, kind: 'mkb-card' },
    { documentId: 'kr.rf.200_1', grade: 1, kind: 'clinical-recommendation' },
  ],
  ...overrides,
});

describe('ICD matching', () => {
  it('normalizes Cyrillic look-alike letters and rejects non-codes', () => {
    expect(normalizeIcdCode('К29.5')).toBe('K29.5');
    expect(normalizeIcdCode(' j06.9 ')).toBe('J06.9');
    expect(normalizeIcdCode('J06.99.1')).toBeNull();
    expect(normalizeIcdCode('гастрит')).toBeNull();
  });

  it('grades the same code, ancestors and descendants as exact', () => {
    expect(icdRelation('K29.5', 'K29.5')).toBe('exact');
    expect(icdRelation('K29.5', 'K29')).toBe('exact');
    expect(icdRelation('K29', 'K29.5')).toBe('exact');
    expect(icdRelation('K29.5', 'K29.1')).toBe('block');
    expect(icdRelation('K29.5', 'K30')).toBeNull();
    expect(icdRelation('K2', 'K29')).toBeNull();
  });

  it('treats a range as covering the blocks inside it', () => {
    expect(icdRelation('C02.1', 'C00-C14')).toBe('exact');
    expect(icdRelation('C15.0', 'C00-C14')).toBeNull();
  });

  it('keeps the strongest relation over several codes', () => {
    expect(bestRelation(['K21.0'], ['K29', 'K21.9'])).toBe('block');
    expect(bestRelation(['K21.0'], ['K29', 'K21'])).toBe('exact');
    expect(bestRelation(['K21.0'], ['I10'])).toBeNull();
  });
});

describe('scoreQuery', () => {
  it('finds the first exact document and counts a duplicate group once', () => {
    const score = scoreQuery(query(), ['kr.rf.999_1', 'kr.rf.200_1', 'kr.rf.200_1', 'kr.rf.100_1']);
    expect(score.exactRank).toBe(3);
    expect(score.anyRank).toBe(2);
    expect(score.recommendationRank).toBe(3);
    expect(score.mkbRank).toBeNull();
  });

  it('computes graded nDCG against the ideal ordering', () => {
    const perfect = scoreQuery(query(), ['kr.rf.100_1', 'rls.mkb.node.k21-0', 'kr.rf.200_1']);
    expect(perfect.ndcgAt10).toBeCloseTo(1, 10);
    const worse = scoreQuery(query(), ['kr.rf.200_1', 'kr.rf.100_1']);
    expect(worse.ndcgAt10).toBeGreaterThan(0);
    expect(worse.ndcgAt10).toBeLessThan(1);
  });

  it('leaves kind-specific ranks undefined when the query has no such document', () => {
    const onlyCard = query({
      relevant: [{ documentId: 'rls.mkb.node.k21-0', grade: 3, kind: 'mkb-card' }],
    });
    expect(scoreQuery(onlyCard, ['rls.mkb.node.k21-0']).recommendationRank).toBeUndefined();
  });

  it('does not look beyond the examined depth', () => {
    const ranked = [...Array.from({ length: 20 }, (_, index) => `noise.${index}`), 'kr.rf.100_1'];
    expect(scoreQuery(query(), ranked).exactRank).toBeNull();
  });
});

describe('aggregation', () => {
  const rows = [
    scoreQuery(query({ id: 'a' }), ['kr.rf.100_1']),
    scoreQuery(query({ id: 'b' }), ['x', 'rls.mkb.node.k21-0']),
    scoreQuery(query({ id: 'c' }), ['x', 'y']),
    scoreQuery(
      query({
        id: 'd',
        relevant: [{ documentId: 'rls.mkb.node.k21-0', grade: 3, kind: 'mkb-card' }],
      }),
      ['rls.mkb.node.k21-0'],
    ),
  ];

  it('averages recall and reciprocal rank over all queries', () => {
    const exact = aggregateExact(rows);
    expect(exact.queries).toBe(4);
    expect(exact.recallAt1).toBeCloseTo(0.5, 10);
    expect(exact.recallAt5).toBeCloseTo(0.75, 10);
    expect(exact.mrrAt10).toBeCloseTo((1 + 0.5 + 0 + 1) / 4, 10);
  });

  it('restricts kind-specific aggregates to queries that have the kind', () => {
    expect(aggregateRecommendations(rows).queries).toBe(3);
    expect(aggregateRecommendations(rows).recallAt1).toBeCloseTo(1 / 3, 10);
    expect(aggregateMkb(rows).queries).toBe(4);
  });
});

describe('parseRetrievalBenchmark', () => {
  const benchmark = {
    schemaVersion: 1,
    id: 'test',
    description: 'test',
    builtAt: '2026-10-02T00:00:00Z',
    corpus: { clinicalRecommendations: 1, mkbCards: 1, note: '' },
    sources: [source],
    queries: [query()],
  };

  it('accepts a well-formed benchmark', () => {
    expect(parseRetrievalBenchmark(benchmark).queries).toHaveLength(1);
  });

  it('rejects a row from an unknown source, without a grade-3 document, or duplicated', () => {
    expect(() =>
      parseRetrievalBenchmark({ ...benchmark, queries: [query({ source: 'other' })] }),
    ).toThrow(/unknown source/u);
    expect(() =>
      parseRetrievalBenchmark({
        ...benchmark,
        queries: [
          query({
            relevant: [{ documentId: 'kr.rf.200_1', grade: 1, kind: 'clinical-recommendation' }],
          }),
        ],
      }),
    ).toThrow(/grade-3/u);
    expect(() => parseRetrievalBenchmark({ ...benchmark, queries: [query(), query()] })).toThrow(
      /duplicate/u,
    );
  });

  it('rejects a source without a licence', () => {
    expect(() =>
      parseRetrievalBenchmark({ ...benchmark, sources: [{ ...source, licence: '' }] }),
    ).toThrow(/licence/u);
  });
});

describe('committed ICD dataset', () => {
  const dataset = loadRetrievalBenchmark(
    resolve(import.meta.dirname, '../retrieval-icd-queries.json'),
  );

  it('only contains rows whose source licence allows redistribution, each with a licence URL', () => {
    expect(dataset.sources.every((item) => item.redistributable && item.licenceUrl !== '')).toBe(
      true,
    );
    expect(dataset.queries.length).toBe(400);
  });

  it('keeps dev and test disjoint in query text and balanced', () => {
    const dev = new Set(
      dataset.queries.filter((row) => row.split === 'dev').map((row) => row.query.toLowerCase()),
    );
    const test = dataset.queries.filter((row) => row.split === 'test');
    expect(dev.size).toBe(200);
    expect(test).toHaveLength(200);
    expect(test.some((row) => dev.has(row.query.toLowerCase()))).toBe(false);
  });

  it('is native Russian: nothing is machine translated, every row names its source record', () => {
    expect(
      dataset.queries.every((row) => !row.machineTranslated && row.sourceRecordId !== ''),
    ).toBe(true);
  });
});
