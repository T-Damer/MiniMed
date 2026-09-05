import type { SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  aggregateFullCorpusSearchEvaluations,
  evaluateFullCorpusSearchQuery,
  type FullCorpusSearchFixture,
  type FullCorpusSearchQuery,
  validateFullCorpusSearchFixture,
} from './full-corpus-search-scoring';

function query(overrides: Partial<FullCorpusSearchQuery> = {}): FullCorpusSearchQuery {
  return {
    id: 'query-0',
    query: 'запрос',
    expectedDocumentIds: ['document-0'],
    style: 'exact-title',
    sourceFamily: 'diseases',
    ...overrides,
  };
}

function fixture(queries: readonly FullCorpusSearchQuery[]): FullCorpusSearchFixture {
  return {
    schemaVersion: 1,
    id: 'fixture',
    description: 'fixture',
    sourceFamily: 'diseases',
    queries,
  };
}

function group(documentId: string, sectionType: string | null = 'other'): SearchResultGroup {
  return {
    documentId,
    title: documentId,
    bestScore: 1,
    categories: ['other'],
    results: [
      {
        chunkId: `${documentId}-chunk`,
        documentId,
        documentVersionId: `${documentId}@v1`,
        sectionId: `${documentId}-section`,
        anchor: `${documentId}@v1/section#chunk-1`,
        title: documentId,
        sectionPath: [documentId],
        snippet: documentId,
        highlightedRanges: [],
        lexicalScore: 1,
        semanticScore: null,
        finalScore: 1,
        matchedTerms: [],
        matchedBranches: [],
        sectionType,
        category: 'other',
      },
    ],
  };
}

describe('full-corpus search fixture and scorer', () => {
  it('requires exactly 500 unique IDs and query texts', () => {
    const queries = Array.from({ length: 500 }, (_, index) =>
      query({ id: `query-${index}`, query: `запрос ${index}` }),
    );
    expect(validateFullCorpusSearchFixture(fixture(queries)).queries).toHaveLength(500);

    expect(() => validateFullCorpusSearchFixture(fixture(queries.slice(0, 499)))).toThrow(
      /exactly 500/,
    );
    expect(() =>
      validateFullCorpusSearchFixture(
        fixture([...queries.slice(0, 499), query({ id: 'query-0', query: 'новый запрос' })]),
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      validateFullCorpusSearchFixture(
        fixture([...queries.slice(0, 499), query({ id: 'query-500', query: 'запрос 0' })]),
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects malformed entries and mismatched source families', () => {
    const queries = Array.from({ length: 500 }, (_, index) =>
      query({ id: `query-${index}`, query: `запрос ${index}` }),
    );
    expect(() =>
      validateFullCorpusSearchFixture({
        ...fixture(queries),
        queries: queries.map((item, index) =>
          index === 1 ? { ...item, sourceFamily: 'mkb-diseases' } : item,
        ),
      }),
    ).toThrow(/sourceFamily/);
    expect(() =>
      validateFullCorpusSearchFixture({
        ...fixture(queries),
        queries: queries.map((item, index) =>
          index === 1 ? { ...item, expectedDocumentIds: [] } : item,
        ),
      }),
    ).toThrow(/expectedDocumentIds/);
  });

  it('scores frozen expected IDs, rank, top1, and section intent', () => {
    const evaluated = evaluateFullCorpusSearchQuery(
      query({
        id: 'section-query',
        expectedDocumentIds: ['frozen-a', 'frozen-b'],
        expectedSectionType: 'diagnostics',
      }),
      [group('live-result'), group('frozen-b', 'diagnostics'), group('frozen-a', 'other')],
      12,
    );

    expect(evaluated).toMatchObject({
      queryId: 'section-query',
      recallAt5: 1,
      reciprocalRankAt5: 0.5,
      top1: false,
      sectionRecallAt5: true,
      elapsedMs: 12,
      topDocumentIds: ['live-result', 'frozen-b', 'frozen-a'],
    });
  });

  it('aggregates recall, MRR, top1, section recall, latency, and slices', () => {
    const rows = [
      evaluateFullCorpusSearchQuery(query({ id: 'one', query: 'one' }), [group('document-0')], 10),
      evaluateFullCorpusSearchQuery(
        query({
          id: 'two',
          query: 'two',
          expectedDocumentIds: ['document-1'],
          style: 'section-intent',
          expectedSectionType: 'diagnostics',
        }),
        [group('other'), group('document-1', 'diagnostics')],
        30,
      ),
    ];
    const aggregate = aggregateFullCorpusSearchEvaluations(rows);
    expect(aggregate).toMatchObject({
      queryCount: 2,
      recallAt5: 1,
      mrrAt5: 0.75,
      top1: 0.5,
      sectionRecallAt5: 1,
      sectionQueryCount: 1,
      latencyMs: { p50: 10, p95: 30 },
    });
  });

  it('does not infer expected IDs from live result groups', () => {
    const evaluated = evaluateFullCorpusSearchQuery(
      query({ expectedDocumentIds: ['frozen-document-id'] }),
      [group('database-document-id')],
      1,
    );
    expect(evaluated.recallAt5).toBe(0);
    expect(evaluated.topDocumentIds).toEqual(['database-document-id']);
  });
});
