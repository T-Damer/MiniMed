import { describe, expect, it } from 'vitest';

import {
  evaluateFrozenRanking,
  groupFrozenCandidates,
  LINEAR_RERANKER_FEATURES,
  parseFrozenCandidate,
  rerankLinearCandidates,
  trainPairwiseLinearReranker,
  type FrozenCandidateRow,
} from './linear-reranker-baseline';

function row(
  fixtureId: string,
  documentId: string,
  originalRank: number,
  relevanceGrade: number,
  topSectionType: string,
): FrozenCandidateRow {
  return {
    fixtureId,
    query: 'У ребенка сохраняются симптомы — что менять в лечении',
    origin: 'legacy-pilot-training',
    family: 'synthetic',
    goal: 'treatment',
    analysis: {
      primaryIntent: 'treatment',
      intentConfidence: 0.9,
      needsClarification: false,
      ageFacts: ['6 лет'],
      positiveFindingCount: 2,
      negativeFindingCount: 0,
      currentMedicineCount: 1,
    },
    retrieval: {
      originalRank,
      groupBestScore: originalRank === 1 ? 2 : 1,
      maximumLexicalScore: originalRank === 1 ? 2 : 1,
      maximumSemanticScore: null,
      maximumFinalScore: originalRank === 1 ? 2 : 1,
      resultCount: 1,
      matchedTermCount: 2,
      matchedBranchCount: 1,
      topSectionType,
      terminologyMatch: null,
      exactTitle: false,
      exactNavigationAlias: false,
      exactDeclaredAlias: false,
    },
    candidate: {
      documentId,
      sourceType: 'clinical_recommendation',
    },
    label: {
      relevanceGrade,
      forbidden: false,
    },
  };
}

describe('linear frozen-candidate reranker', () => {
  it('parses the exported pair contract', () => {
    const parsed = parseFrozenCandidate(row('fixture', 'doc', 1, 3, 'treatment'));
    expect(parsed.fixtureId).toBe('fixture');
    expect(parsed.retrieval.originalRank).toBe(1);
    expect(parsed.label.relevanceGrade).toBe(3);
  });

  it('learns a pairwise treatment-section preference that can override original rank', () => {
    const training = [
      row('train-1', 'wrong-1', 1, 0, 'clinical-picture'),
      row('train-1', 'right-1', 2, 3, 'treatment'),
      row('train-2', 'wrong-2', 1, 0, 'diagnostics'),
      row('train-2', 'right-2', 2, 3, 'treatment'),
    ];
    const model = trainPairwiseLinearReranker(training, {
      epochs: 300,
      learningRate: 0.08,
      l2: 0.001,
    });

    expect(model.weights).toHaveLength(LINEAR_RERANKER_FEATURES.length);
    const fixture = [
      row('test', 'wrong', 1, 0, 'clinical-picture'),
      row('test', 'right', 2, 3, 'treatment'),
    ];
    expect(rerankLinearCandidates(fixture, model)[0]?.candidate.documentId).toBe('right');
  });

  it('reports ranking metrics from exactly the frozen document set', () => {
    const groups = groupFrozenCandidates([
      row('fixture-1', 'wrong', 1, 0, 'clinical-picture'),
      row('fixture-1', 'right', 2, 3, 'treatment'),
    ]);
    const metrics = evaluateFrozenRanking(groups);
    expect(metrics.fixtureCount).toBe(1);
    expect(metrics.top1MaxGrade).toBe(0);
    expect(metrics.relevantRecallAt20).toBe(1);
    expect(metrics.ndcgAt5).toBeGreaterThan(0);
    expect(metrics.ndcgAt5).toBeLessThan(1);
  });
});
