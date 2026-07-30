import type { SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import type { HardMedicalQuery } from './hard-query-dataset';
import { aggregateHardQueryEvaluations, evaluateHardQuery } from './hard-query-scoring';

const FIXTURE: HardMedicalQuery = {
  query_id: 'MED-TEST-1',
  scenario_id: 'MED-TEST',
  query: 'грудничок свистит при дыхании',
  language: 'ru',
  domain: 'medicine',
  specialty: 'respiratory',
  age_group: 'infant',
  intent: 'diagnosis',
  style: 'colloquial',
  difficulty: 'medium',
  answerability: 'answerable',
  split: 'validation',
  required_entities: ['бронхиолит'],
  acceptable_entities: ['бронхообструктивный синдром'],
  forbidden_or_dangerous: ['регистрационная запись антибиотика'],
  expected_sections: ['clinical_picture'],
  expected_terms: ['свистящее дыхание'],
  grading: {
    required_gain: 3,
    acceptable_gain: 1,
    irrelevant_gain: 0,
    forbidden_gain: -3,
  },
};

function group(
  documentId: string,
  title: string,
  sectionType: string,
  snippet: string,
): SearchResultGroup {
  return {
    documentId,
    title,
    bestScore: 1,
    categories: ['other'],
    results: [
      {
        chunkId: `${documentId}:chunk`,
        documentId,
        documentVersionId: `${documentId}@v1`,
        sectionId: `${documentId}:section`,
        anchor: `${documentId}@v1/section#chunk-1`,
        title,
        sectionPath: [title],
        snippet,
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

describe('hard query scoring', () => {
  it('finds required and section matches while retaining a separate safety signal', () => {
    const rows = [
      group('irrelevant', 'Регистрационная запись антибиотика', 'other', 'Амоксициллин'),
      group('bronchiolitis', 'Бронхиолит у детей', 'clinical-picture', 'Свистящее дыхание'),
    ];

    const evaluation = evaluateHardQuery(FIXTURE, rows, 12);
    expect(evaluation).toMatchObject({
      requiredRank: 2,
      requiredAt1: false,
      requiredAt3: true,
      requiredAt5: true,
      expectedSectionAt5: true,
      forbiddenAt5: true,
      reciprocalRank: 0.5,
    });
  });

  it('aggregates retrieval, safety and latency metrics', () => {
    const first = evaluateHardQuery(
      FIXTURE,
      [group('bronchiolitis', 'Бронхиолит', 'clinical-picture', 'Свистящее дыхание')],
      10,
    );
    const second = evaluateHardQuery(
      { ...FIXTURE, query_id: 'MED-TEST-2' },
      [group('other', 'Острый бронхит', 'treatment', 'Наблюдение')],
      30,
    );

    expect(aggregateHardQueryEvaluations([first, second])).toMatchObject({
      queryCount: 2,
      recallAt1: 0.5,
      recallAt5: 0.5,
      mrrAt5: 0.5,
      expectedSectionRecallAt5: 0.5,
      forbiddenRateAt5: 0,
      latencyMs: { p50: 10, p95: 30, p99: 30 },
    });
  });
});
