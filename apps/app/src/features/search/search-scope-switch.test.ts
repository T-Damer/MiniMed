import type { SearchResponse, SearchResult, SearchResultGroup } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { narrowSearchResponseForScope } from '@/features/search/search-scope-switch';

function makeResult(documentId: string): SearchResult {
  return {
    chunkId: `${documentId}:c1`,
    documentId,
    documentVersionId: `${documentId}:v1`,
    sectionId: `${documentId}:s1`,
    sectionPath: ['Раздел'],
    sectionType: 'general',
    title: documentId,
    snippet: 'Текст фрагмента',
    highlightedRanges: [],
    anchor: 's1',
    lexicalScore: 1,
    semanticScore: null,
    finalScore: 1,
    matchedTerms: ['акинетон'],
    matchedBranches: ['exact'],
    category: 'overview',
  };
}

function makeGroup(
  documentId: string,
  documentType: NonNullable<SearchResultGroup['documentType']>,
): SearchResultGroup {
  return {
    documentId,
    title: documentId,
    bestScore: 1,
    categories: ['overview'],
    documentType,
    results: [makeResult(documentId)],
  };
}

function makeResponse(groups: readonly SearchResultGroup[]): SearchResponse {
  return {
    requestId: 'req-1',
    normalizedQuery: 'акинетон',
    elapsedMs: 10,
    modeUsed: 'lexical',
    analysis: {
      originalQuery: 'акинетон',
      normalizedQuery: 'акинетон',
      intent: {
        primary: 'medication',
        secondary: [],
        confidence: 0.9,
        matchedSignals: [],
        needsClarification: false,
      },
      facts: [],
      branches: [],
      suggestions: [],
      warnings: [],
    },
    suggestions: [],
    groups,
    diagnostics: {
      ftsQuery: 'акинетон',
      candidateCount: groups.length,
      aliasMatches: [],
      terms: ['акинетон'],
      branches: [],
      semantic: {
        status: 'disabled',
        requestedMode: 'lexical',
        profileId: null,
        candidateCount: 0,
        elapsedMs: 0,
        fallbackReason: null,
      },
    },
  };
}

describe('narrowSearchResponseForScope', () => {
  const response = makeResponse([
    makeGroup('esklp.mnn.biperiden', 'medication'),
    makeGroup('kr.rf.507_4', 'clinical-recommendation'),
    makeGroup('rls.mkb.node.g20', 'icd10'),
  ]);

  const docs = new Map([
    ['esklp.mnn.biperiden', { sourceType: 'official_registry_summary', metadata: {} }],
    ['kr.rf.507_4', { sourceType: 'clinical_recommendation', metadata: {} }],
    ['rls.mkb.node.g20', { sourceType: 'rls_mkb_reference', metadata: {} }],
  ]);

  it('narrows previous groups to the target section and marks the preview partial', () => {
    const narrowed = narrowSearchResponseForScope(response, 'medications', docs);
    expect(narrowed?.partial).toBe(true);
    expect(narrowed?.groups.map((group) => group.documentId)).toEqual(['esklp.mnn.biperiden']);
  });

  it('falls back to group documentType when navigation documents have not loaded yet', () => {
    const narrowed = narrowSearchResponseForScope(response, 'guidelines', new Map());
    expect(narrowed?.partial).toBe(true);
    expect(narrowed?.groups.map((group) => group.documentId)).toEqual(['kr.rf.507_4']);
  });

  it('returns undefined when no visible result belongs to the target section', () => {
    expect(narrowSearchResponseForScope(response, 'legal', docs)).toBeUndefined();
  });

  it('keeps all groups as a partial preview when broadening back to all sources', () => {
    const narrowed = narrowSearchResponseForScope(response, 'all', docs);
    expect(narrowed?.partial).toBe(true);
    expect(narrowed?.groups).toHaveLength(3);
  });
});
