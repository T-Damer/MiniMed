import { describe, expect, it } from 'vitest';

import {
  calibrateLinearAbstentionGate,
  evaluateFrozenRanking,
  groupFrozenCandidates,
  LINEAR_RERANKER_FEATURES,
  linearCandidatesForFixture,
  parseFrozenCandidate,
  rerankLinearCandidates,
  rerankLinearCandidatesGated,
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
    schemaVersion: 2,
    fixtureId,
    query: 'У ребенка сохраняются симптомы — что менять в лечении',
    origin: 'legacy-pilot-training',
    family: 'synthetic',
    goal: 'treatment',
    answerability: 'focused',
    analysis: {
      primaryIntent: 'treatment',
      secondaryIntents: [],
      intentConfidence: 0.9,
      needsClarification: false,
      ageFacts: ['6 лет'],
      positiveFindingCount: 2,
      positiveFindings: ['кашель', 'лихорадка'],
      negativeFindingCount: 0,
      negativeFindings: [],
      currentMedicineCount: 1,
      currentMedicines: ['амоксициллин'],
      branchKinds: ['clinical'],
    },
    retrieval: {
      requestedMode: 'lexical',
      modeUsed: 'lexical',
      originalRank,
      groupBestScore: originalRank === 1 ? 2 : 1,
      maximumLexicalScore: originalRank === 1 ? 2 : 1,
      maximumSemanticScore: null,
      maximumFinalScore: originalRank === 1 ? 2 : 1,
      resultCount: 1,
      matchedTermCount: 2,
      matchedBranchCount: 1,
      matchedTerms: ['кашель', 'лихорадка'],
      matchedBranches: ['clinical'],
      coreCandidateCount: 2,
      semanticStatus: 'disabled',
      semanticCandidateCount: 0,
      sectionTypes: [topSectionType],
      topSectionType,
      terminologyMatch: null,
      exactTitle: false,
      exactShortTitle: false,
      exactNavigationAlias: false,
      exactDeclaredAlias: false,
    },
    candidate: {
      documentId,
      conceptId: null,
      canonicalName: documentId,
      shortTitle: null,
      sourceType: 'clinical_recommendation',
      navigationAliases: [],
      declaredAliases: [],
      ageGroups: ['children'],
      evidence: 'Кашель и лихорадка у ребенка.',
    },
    label: {
      relevanceGrade,
      expectedSectionTypes: [topSectionType],
      forbidden: false,
    },
  };
}

describe('linear frozen-candidate reranker', () => {
  it('parses the exported pair contract', () => {
    const parsed = parseFrozenCandidate(row('fixture', 'doc', 1, 3, 'treatment'));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.fixtureId).toBe('fixture');
    expect(parsed.retrieval.originalRank).toBe(1);
    expect(parsed.retrieval.exactShortTitle).toBe(false);
    expect(parsed.candidate.canonicalName).toBe('doc');
    expect(parsed.retrieval.sectionTypes).toEqual(['treatment']);
    expect(parsed.label.expectedSectionTypes).toEqual(['treatment']);
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
    expect(model.hardTrainingPairs).toBe(2);
    expect(model.easyTrainingPairs).toBe(0);
    expect(model.weightedTrainingPairs).toBeGreaterThan(model.trainingPairs);
    const fixture = [
      row('test', 'wrong', 1, 0, 'clinical-picture'),
      row('test', 'right', 2, 3, 'treatment'),
    ];
    expect(rerankLinearCandidates(fixture, model)[0]?.candidate.documentId).toBe('right');
  });


  it('calibrates a conservative top-1 abstention gate on training labels only', () => {
    const training = [
      row('gate-fix', 'wrong-fix', 1, 0, 'clinical-picture'),
      row('gate-fix', 'right-fix', 2, 3, 'treatment'),
      row('gate-anchor', 'right-anchor', 1, 3, 'treatment'),
      row('gate-anchor', 'wrong-anchor', 2, 0, 'clinical-picture'),
    ];
    const model = trainPairwiseLinearReranker(training, {
      epochs: 300,
      learningRate: 0.08,
      l2: 0.001,
    });
    const groups = groupFrozenCandidates(training);
    const gate = calibrateLinearAbstentionGate(groups, model);
    const gated = (rows: readonly FrozenCandidateRow[]) =>
      rerankLinearCandidatesGated(rows, model, gate);

    expect(gate.policy).toBe('zero-regression-max-fixes');
    expect(gate.trainingRegressedTop1).toBe(0);
    expect(evaluateFrozenRanking(groups, gated).top1MaxGrade).toBeGreaterThanOrEqual(
      evaluateFrozenRanking(groups).top1MaxGrade,
    );
  });

  it('separates previous-treatment dominance from clinical finding coverage', () => {
    const base = row('test-treatment-context', 'clinical-source', 1, 3, 'treatment');
    const medicineOnly: FrozenCandidateRow = {
      ...base,
      candidate: { ...base.candidate, documentId: 'medicine-only-source' },
      retrieval: {
        ...base.retrieval,
        originalRank: 2,
        matchedTermCount: 1,
        matchedTerms: ['амоксициллин'],
      },
    };
    const mixed: FrozenCandidateRow = {
      ...base,
      candidate: { ...base.candidate, documentId: 'mixed-source' },
      retrieval: {
        ...base.retrieval,
        originalRank: 3,
        matchedTermCount: 2,
        matchedTerms: ['амоксициллин', 'кашель'],
      },
    };
    const candidates = linearCandidatesForFixture([base, medicineOnly, mixed]);
    const featureIndex = LINEAR_RERANKER_FEATURES.indexOf('currentMedicineMatchDominance');
    expect(featureIndex).toBeGreaterThanOrEqual(0);
    expect(candidates[0]?.features[featureIndex]).toBe(0);
    expect(candidates[1]?.features[featureIndex]).toBe(1);
    expect(candidates[2]?.features[featureIndex]).toBe(0.5);
  });

  it('separates clinical candidate text from medication-source dominance', () => {
    const base = row('test-candidate-text', 'clinical-source', 1, 3, 'treatment');
    const clinical: FrozenCandidateRow = {
      ...base,
      candidate: {
        ...base.candidate,
        canonicalName: 'Пневмония у детей',
        evidence: 'Кашель, лихорадка и ухудшение состояния требуют пересмотра терапии.',
      },
    };
    const medicine: FrozenCandidateRow = {
      ...base,
      candidate: {
        ...base.candidate,
        documentId: 'drug-source',
        canonicalName: 'Амоксициллин',
        sourceType: 'official_drug_instruction',
        evidence: 'Амоксициллин: инструкция по медицинскому применению.',
      },
      retrieval: {
        ...base.retrieval,
        originalRank: 2,
        matchedTerms: ['амоксициллин'],
        matchedTermCount: 1,
      },
    };
    const candidates = linearCandidatesForFixture([clinical, medicine]);
    const findingIndex = LINEAR_RERANKER_FEATURES.indexOf('candidatePositiveFindingCoverage');
    const medicineSourceIndex = LINEAR_RERANKER_FEATURES.indexOf(
      'clinicalNarrativeMedicationSource',
    );
    expect(candidates[0]?.features[findingIndex]).toBeGreaterThan(
      candidates[1]?.features[findingIndex] ?? 0,
    );
    expect(candidates[0]?.features[medicineSourceIndex]).toBe(0);
    expect(candidates[1]?.features[medicineSourceIndex]).toBe(1);
  });

  it('treats universal age metadata as neutral instead of adult-only', () => {
    const child = row('test-age', 'child', 1, 3, 'clinical-picture');
    const universal: FrozenCandidateRow = {
      ...child,
      candidate: { ...child.candidate, documentId: 'universal', ageGroups: ['all'] },
      retrieval: { ...child.retrieval, originalRank: 2 },
    };
    const adult: FrozenCandidateRow = {
      ...child,
      candidate: { ...child.candidate, documentId: 'adult', ageGroups: ['adults'] },
      retrieval: { ...child.retrieval, originalRank: 3 },
    };
    const candidates = linearCandidatesForFixture([child, universal, adult]);
    const featureIndex = LINEAR_RERANKER_FEATURES.indexOf('pediatricAgeCompatibility');
    expect(featureIndex).toBeGreaterThanOrEqual(0);
    expect(candidates[0]?.features[featureIndex]).toBe(1);
    expect(candidates[1]?.features[featureIndex]).toBe(0);
    expect(candidates[2]?.features[featureIndex]).toBe(-1);
  });

  it('rejects duplicate, gapped, or mixed frozen candidate groups', () => {
    const first = row('fixture-integrity', 'one', 1, 3, 'treatment');
    const duplicateDocument: FrozenCandidateRow = {
      ...row('fixture-integrity', 'two', 2, 0, 'clinical-picture'),
      candidate: { ...first.candidate },
    };
    expect(() => groupFrozenCandidates([first, duplicateDocument])).toThrow(
      'duplicate frozen candidate document',
    );

    const gapped = row('fixture-gap', 'two', 3, 0, 'clinical-picture');
    expect(() => groupFrozenCandidates([row('fixture-gap', 'one', 1, 3, 'treatment'), gapped]))
      .toThrow('ranks must be contiguous');

    const mixedQuery: FrozenCandidateRow = {
      ...row('fixture-mixed', 'two', 2, 0, 'clinical-picture'),
      query: 'Совсем другой запрос',
    };
    expect(() =>
      groupFrozenCandidates([row('fixture-mixed', 'one', 1, 3, 'treatment'), mixedQuery]),
    ).toThrow('disagree on fixture metadata');
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
