import { describe, expect, it } from 'vitest';

import {
  frozenCandidateText,
  rerankPortableEmbeddingCandidates,
} from './frozen-embedding-baseline';
import type { FrozenCandidateRow } from './linear-reranker-baseline';

function row(
  documentId: string,
  originalRank: number,
  canonicalName: string,
  evidence: string,
): FrozenCandidateRow {
  return {
    schemaVersion: 2,
    fixtureId: 'embedding-fixture',
    query: 'У ребенка кашель, лихорадка и тахипноэ',
    origin: 'graded-challenge',
    family: 'respiratory',
    goal: 'diagnosis-navigation',
    answerability: 'focused',
    analysis: {
      primaryIntent: 'diagnosis',
      secondaryIntents: [],
      intentConfidence: 0.9,
      needsClarification: false,
      ageFacts: ['6 лет'],
      positiveFindingCount: 3,
      positiveFindings: ['кашель', 'лихорадка', 'тахипноэ'],
      negativeFindingCount: 0,
      negativeFindings: [],
      currentMedicineCount: 0,
      currentMedicines: [],
      branchKinds: ['clinical'],
    },
    retrieval: {
      requestedMode: 'hybrid',
      modeUsed: 'hybrid',
      originalRank,
      groupBestScore: 1,
      maximumLexicalScore: 1,
      maximumSemanticScore: 0,
      maximumFinalScore: 1,
      resultCount: 1,
      matchedTermCount: 1,
      matchedBranchCount: 1,
      matchedTerms: [],
      matchedBranches: ['clinical'],
      coreCandidateCount: 2,
      semanticStatus: 'used',
      semanticCandidateCount: 2,
      sectionTypes: ['clinical-picture'],
      topSectionType: 'clinical-picture',
      terminologyMatch: null,
      exactTitle: false,
      exactShortTitle: false,
      exactNavigationAlias: false,
      exactDeclaredAlias: false,
    },
    candidate: {
      documentId,
      conceptId: 'SECRET_CONCEPT_TOKEN',
      canonicalName,
      shortTitle: null,
      sourceType: 'clinical_recommendation',
      navigationAliases: [],
      declaredAliases: [],
      ageGroups: ['children'],
      evidence,
    },
    label: {
      relevanceGrade: 0,
      expectedSectionTypes: ['clinical-picture'],
      forbidden: false,
    },
  };
}

describe('frozen portable embedding baseline', () => {
  it('scores only user-visible candidate text and does not leak internal IDs', () => {
    const base = row(
      'SECRET_DOCUMENT_TOKEN',
      1,
      'Инфекция мочевых путей',
      'Дизурия и изменения анализа мочи.',
    );
    const candidate: FrozenCandidateRow = {
      ...base,
      candidate: {
        ...base.candidate,
        shortTitle: 'Инфекция мочевых путей',
        navigationAliases: ['ИНФЕКЦИЯ МОЧЕВЫХ ПУТЕЙ'],
      },
    };
    const text = frozenCandidateText(candidate);
    expect(text).toContain('Инфекция мочевых путей');
    expect(text.match(/Инфекция мочевых путей/gu)).toHaveLength(1);
    expect(text).not.toContain('ИНФЕКЦИЯ МОЧЕВЫХ ПУТЕЙ');
    expect(text).not.toContain('SECRET_DOCUMENT_TOKEN');
    expect(text).not.toContain('SECRET_CONCEPT_TOKEN');
  });

  it('can reorder the same frozen candidate set by query-to-candidate text similarity', () => {
    const unrelated = row(
      'uti',
      1,
      'Инфекция мочевых путей',
      'Дизурия, частое мочеиспускание и исследование мочи.',
    );
    const respiratory = row(
      'respiratory',
      2,
      'Респираторное заболевание',
      'Кашель, лихорадка, тахипноэ и втяжение грудной клетки.',
    );

    const reranked = rerankPortableEmbeddingCandidates([unrelated, respiratory]);
    expect(reranked.map((candidate) => candidate.candidate.documentId)).toEqual([
      'respiratory',
      'uti',
    ]);
  });

  it('rejects accidental mixing of candidate pools from different queries', () => {
    const first = row('one', 1, 'Первый', 'Кашель.');
    const secondBase = row('two', 2, 'Второй', 'Лихорадка.');
    const second = { ...secondBase, query: 'Другой запрос' };
    expect(() => rerankPortableEmbeddingCandidates([first, second])).toThrow(
      'one frozen query',
    );
  });
});
