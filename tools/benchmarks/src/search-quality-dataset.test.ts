import { describe, expect, it } from 'vitest';

import {
  aggregateSearchQuality,
  evaluateSearchQuality,
  parseSearchQualityFixtures,
} from './search-quality-dataset';

const result = (documentId: string, sectionType: string) => ({
  chunkId: `${documentId}.chunk`,
  documentId,
  documentVersionId: `${documentId}.v1`,
  sectionId: `${documentId}.section`,
  anchor: `${documentId}#chunk`,
  title: documentId,
  sectionPath: [],
  snippet: '',
  highlightedRanges: [],
  lexicalScore: 1,
  semanticScore: null,
  finalScore: 1,
  matchedTerms: [],
  matchedBranches: [],
  sectionType,
  category: 'other' as const,
});

const group = (documentId: string, sectionType = 'clinical-picture') => ({
  documentId,
  title: documentId,
  bestScore: 1,
  categories: ['other' as const],
  results: [result(documentId, sectionType)],
});

describe('search quality v2 dataset', () => {
  it('rejects answer-name leakage in clinical queries', () => {
    expect(() =>
      parseSearchQualityFixtures([
        {
          id: 'leak',
          query: 'пневмония у ребенка',
          origin: 'manual-challenge',
          family: 'respiratory',
          goal: 'diagnosis-navigation',
          answerability: 'focused',
          relevance: [
            { documentId: 'pneumonia', grade: 3, sectionTypes: ['clinical-picture'] },
          ],
          leakageTerms: ['пневмония'],
          forbiddenDocumentIds: [],
          rationale: 'fixture',
        },
      ]),
    ).toThrow(/leaks answer term/u);
  });

  it('requires multi-relevance for deliberately ambiguous cases', () => {
    expect(() =>
      parseSearchQualityFixtures([
        {
          id: 'ambiguous',
          query: 'кашель и температура',
          origin: 'manual-challenge',
          family: 'respiratory',
          goal: 'diagnosis-navigation',
          answerability: 'ambiguous',
          relevance: [{ documentId: 'a', grade: 3, sectionTypes: ['clinical-picture'] }],
          leakageTerms: ['пневмония'],
          forbiddenDocumentIds: [],
          rationale: 'fixture',
        },
      ]),
    ).toThrow(/at least two relevant documents/u);
  });

  it('scores graded relevance instead of forcing one gold label', () => {
    const [fixture] = parseSearchQualityFixtures([
      {
        id: 'graded',
        query: 'грудничок свистит после насморка',
        origin: 'manual-challenge',
        family: 'respiratory',
        goal: 'diagnosis-navigation',
        answerability: 'ambiguous',
        relevance: [
          { documentId: 'best', grade: 3, sectionTypes: ['clinical-picture'] },
          { documentId: 'also', grade: 2, sectionTypes: ['clinical-picture'] },
        ],
        leakageTerms: ['бронхиолит'],
        forbiddenDocumentIds: ['wrong'],
        rationale: 'fixture',
      },
    ]);
    if (!fixture) throw new Error('fixture missing');

    const evaluation = evaluateSearchQuality(
      fixture,
      [group('also'), group('best'), group('wrong')],
      'lexical',
      4,
      'lexical',
    );
    expect(evaluation.hitAt5).toBe(true);
    expect(evaluation.relevantRecallAt20).toBe(1);
    expect(evaluation.weightedRecallAt20).toBe(1);
    expect(evaluation.top1MaxGrade).toBe(false);
    expect(evaluation.ndcgAt5).toBeGreaterThan(0.8);
    expect(evaluation.ndcgAt5).toBeLessThan(1);
    expect(evaluation.forbiddenAt5).toBe(true);
    expect(evaluation.sectionHitAt5).toBe(true);
  });

  it('aggregates candidate recall independently from top-one quality', () => {
    const [fixture] = parseSearchQualityFixtures([
      {
        id: 'aggregate',
        query: 'температура и кашель',
        origin: 'manual-challenge',
        family: 'respiratory',
        goal: 'diagnosis-navigation',
        answerability: 'ambiguous',
        relevance: [
          { documentId: 'a', grade: 2, sectionTypes: ['clinical-picture'] },
          { documentId: 'b', grade: 2, sectionTypes: ['clinical-picture'] },
        ],
        leakageTerms: ['пневмония'],
        forbiddenDocumentIds: [],
        rationale: 'fixture',
      },
    ]);
    if (!fixture) throw new Error('fixture missing');

    const row = evaluateSearchQuality(
      fixture,
      [group('noise'), group('a'), group('b')],
      'hybrid',
      8,
      'hybrid',
    );
    const aggregate = aggregateSearchQuality([row]);
    expect(aggregate.top1MaxGrade).toBe(0);
    expect(aggregate.relevantRecallAt20).toBe(1);
    expect(aggregate.hitAt5).toBe(1);
  });
});
