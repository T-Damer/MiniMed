import type {
  MedicalCore,
  MedicalDocumentSummary,
  SearchRequest,
  SearchResponse,
} from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import { inferSearchScope, ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';

function document(id: string, sourceType: string): MedicalDocumentSummary {
  return {
    id,
    title: id,
    shortTitle: null,
    sourceType,
    status: 'active',
    specialties: [],
    versionId: `${id}.v1`,
    versionLabel: '1',
    effectiveFrom: null,
  };
}

function response(): SearchResponse {
  return {
    requestId: 'test',
    normalizedQuery: 'test',
    elapsedMs: 0,
    modeUsed: 'lexical',
    analysis: {
      originalQuery: 'test',
      normalizedQuery: 'test',
      facts: [],
      branches: [],
      suggestions: [],
      warnings: [],
    },
    suggestions: [],
    groups: [],
    diagnostics: {
      ftsQuery: 'test',
      candidateCount: 0,
      aliasMatches: [],
      terms: [],
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

function request(documentIds?: readonly string[]): SearchRequest {
  return {
    query: 'test',
    mode: 'lexical',
    filters: documentIds ? { documentIds: [...documentIds] } : {},
    limit: 20,
    includeSuggestions: true,
  };
}

function coreWithDocuments(documents: readonly MedicalDocumentSummary[]) {
  const search = vi.fn(async (_request: SearchRequest) => ({
    ok: true as const,
    value: response(),
  }));
  const listDocuments = vi.fn(async () => ({ ok: true as const, value: documents }));
  const analyzeQuery = vi.fn(async () => ({
    ok: true as const,
    value: response().analysis,
  }));
  const ask = vi.fn(async () => ({ ok: true as const, value: { text: 'ok' } }));
  const core = {
    search,
    listDocuments,
    analyzeQuery,
    ask,
  } as unknown as MedicalCore;
  return { core, search, listDocuments, analyzeQuery, ask };
}

describe('ScopedMedicalCore', () => {
  const documents = [
    document('guideline', 'clinical_recommendation'),
    document('guideline-summary', 'clinical_recommendation_summary'),
    document('drug', 'official_drug_instruction'),
    document('registry', 'official_registry_summary'),
    document('law', 'regulatory_act'),
    document('law-summary', 'regulatory_act_summary'),
  ];

  it('limits medication searches to official medication documents', async () => {
    const base = coreWithDocuments(documents);
    const assistant = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, assistant.core, 'medications');

    await scoped.search(request());

    expect(base.search).toHaveBeenCalledOnce();
    expect(assistant.search).not.toHaveBeenCalled();
    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(['drug', 'registry']);
  });

  it('intersects an existing document filter with the selected source family', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, undefined, 'guidelines');

    await scoped.search(request(['guideline-summary', 'drug']));

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(['guideline-summary']);
  });

  it('uses an impossible document id when the selected family is not installed', async () => {
    const base = coreWithDocuments(
      documents.filter(
        (item) =>
          item.sourceType !== 'regulatory_act' && item.sourceType !== 'regulatory_act_summary',
      ),
    );
    const scoped = new ScopedMedicalCore(base.core, undefined, 'legal');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual([
      '__minimed_empty_search_scope__',
    ]);
  });

  it('includes regulatory source cards and full acts in legal search', async () => {
    const base = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, undefined, 'legal');

    await scoped.search(request());

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(['law', 'law-summary']);
  });

  it('uses the grounded assistant only for diagnosis', async () => {
    const base = coreWithDocuments(documents);
    const assistant = coreWithDocuments(documents);
    const scoped = new ScopedMedicalCore(base.core, assistant.core, 'diagnosis');

    await scoped.search(request());
    await scoped.analyzeQuery({ query: 'test', includeSuggestions: true });

    expect(assistant.search).toHaveBeenCalledOnce();
    expect(assistant.analyzeQuery).toHaveBeenCalledOnce();
    expect(base.search).not.toHaveBeenCalled();
  });
});

describe('inferSearchScope', () => {
  it('maps confident intents and leaves ambiguous requests for the user', () => {
    const intent = (
      primary: 'diagnosis' | 'medication' | 'administrative-reference' | 'treatment' | 'mixed',
      confidence = 0.8,
    ) => ({
      primary,
      secondary: [],
      confidence,
      matchedSignals: [],
      needsClarification: false,
    });

    expect(inferSearchScope(intent('diagnosis'))).toBe('diagnosis');
    expect(inferSearchScope(intent('medication'))).toBe('medications');
    expect(inferSearchScope(intent('administrative-reference'))).toBe('legal');
    expect(inferSearchScope(intent('treatment'))).toBe('guidelines');
    expect(inferSearchScope(intent('mixed'))).toBeUndefined();
    expect(inferSearchScope(intent('diagnosis', 0.4))).toBeUndefined();
  });
});
