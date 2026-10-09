import type {
  MedicalCore,
  SearchDocumentDescriptor,
  SearchRequest,
  SearchResponse,
  SearchResultGroup,
} from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';

function pointer(
  id: string,
  title: string,
  metadata: Record<string, unknown>,
): SearchDocumentDescriptor {
  return {
    id,
    title,
    shortTitle: null,
    sourceType: 'core_catalog_pointer',
    metadata: { contentMode: 'module-pointer', catalogFamily: 'reference', ...metadata },
  };
}

const ARTICLES = Array.from({ length: 4 }, (_, index) =>
  pointer(`kim.${index}`, `Статья ${index}`, {
    publisher: 'Красота и медицина',
    entityType: 'disease',
    targetDocumentId: `krasotaimedicina.${index}`,
  }),
);
const CARDS = Array.from({ length: 3 }, (_, index) =>
  pointer(`mkb.${index}`, `J1${index} Карточка`, {
    publisher: 'Регистр лекарственных средств России',
    entityType: 'disease',
    mkbCode: `J1${index}`,
  }),
);
const DOCUMENTS = [...ARTICLES, ...CARDS, pointer('other', 'Пневмония', { entityType: 'disease' })];

function analysis(query: string): SearchResponse['analysis'] {
  return {
    originalQuery: query,
    normalizedQuery: query.toLowerCase(),
    facts: [],
    branches: [],
    suggestions: [],
    warnings: [],
  };
}

function groupOf(documentId: string): SearchResultGroup {
  return {
    documentId,
    title: documentId,
    bestScore: 1,
    categories: ['other'],
    results: [],
  };
}

function searchResponse(query: string, groups: readonly SearchResultGroup[]): SearchResponse {
  return {
    requestId: 'test',
    normalizedQuery: query.toLowerCase(),
    elapsedMs: 0,
    modeUsed: 'lexical',
    analysis: analysis(query),
    suggestions: [],
    groups,
    diagnostics: {
      ftsQuery: query,
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

function lookup(query: string, extra: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
    ...extra,
  };
}

/** A core whose search answers every document of the filter (or `hits` when given). */
function fakeCore(hits?: (request: SearchRequest) => readonly string[]) {
  const search = vi.fn(async (request: SearchRequest) => ({
    ok: true as const,
    value: searchResponse(
      request.query,
      (hits?.(request) ?? request.filters.documentIds ?? DOCUMENTS.map((d) => d.id)).map(groupOf),
    ),
  }));
  const analyzeQuery = vi.fn(async (request: { query: string }) => ({
    ok: true as const,
    value: analysis(request.query),
  }));
  const core = {
    search,
    analyzeQuery,
    listSearchDocuments: async () => ({ ok: true as const, value: DOCUMENTS }),
    listDocuments: async () => ({ ok: true as const, value: [] }),
  } as unknown as MedicalCore;
  return { core, search, analyzeQuery };
}

describe('a query that names a source', () => {
  it('searches the rest of the words inside the source', async () => {
    const base = fakeCore();
    const result = await new ScopedMedicalCore(base.core, 'all').search(
      lookup('Красота и медицина пневмония'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(base.search).toHaveBeenCalledOnce();
    expect(base.search.mock.calls[0]?.[0].query).toBe('пневмония');
    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(ARTICLES.map((a) => a.id));
    expect(result.value.sourceScope).toEqual({
      id: 'publisher:красота и медицина',
      label: 'Красота и медицина',
      documentCount: 4,
      remainder: 'пневмония',
    });
    // The screen matches a response to the field by the typed text.
    expect(result.value.analysis.originalQuery).toBe('Красота и медицина пневмония');
  });

  it('lists the source for a bare name without running a search', async () => {
    const base = fakeCore();
    const result = await new ScopedMedicalCore(base.core, 'all').search(lookup('КиМ'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(base.search).not.toHaveBeenCalled();
    expect(result.value.groups).toEqual([]);
    expect(result.value.sourceScope).toMatchObject({ label: 'Красота и медицина', remainder: '' });
    expect(result.value.analysis.originalQuery).toBe('КиМ');
  });

  it('keeps the dictionary meanings of a name spelled in full, but lists no text', async () => {
    const base = fakeCore();
    const result = await new ScopedMedicalCore(base.core, 'all').search(
      lookup('Красота и медицина'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(base.search).toHaveBeenCalledOnce();
    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toBeUndefined();
    expect(result.value.groups).toEqual([]);
    expect(result.value.sourceScope).toMatchObject({ remainder: '', documentCount: 4 });
  });

  it('names a collection by the card type: МКБ-10 cards also carry no publisher of their own', async () => {
    const base = fakeCore();
    await new ScopedMedicalCore(base.core, 'all').search(lookup('мкб-10 j11'));

    expect(base.search.mock.calls[0]?.[0].query).toBe('j11');
    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toEqual(CARDS.map((c) => c.id));
  });

  it('stays inside the section the doctor picked', async () => {
    const base = fakeCore();
    const result = await new ScopedMedicalCore(base.core, 'guidelines').search(
      lookup('Красота и медицина пневмония'),
    );

    // The articles are not in «Клинические рекомендации»: the words are searched as typed.
    expect(result.ok && result.value.sourceScope).toBeFalsy();
    expect(base.search.mock.calls[0]?.[0].query).toBe('Красота и медицина пневмония');
  });

  it('searches the typed words when nothing inside the source matches', async () => {
    const base = fakeCore((request) => (request.query === 'пневмония' ? [] : ['other']));
    const result = await new ScopedMedicalCore(base.core, 'all').search(
      lookup('Красота и медицина пневмония'),
    );

    expect(base.search).toHaveBeenCalledTimes(2);
    expect(base.search.mock.calls[1]?.[0].query).toBe('Красота и медицина пневмония');
    expect(result.ok && result.value.sourceScope).toBeFalsy();
    expect(result.ok && result.value.groups.map((group) => group.documentId)).toEqual(['other']);
  });

  it('is skipped when asked to search the words as they are, and outside lookup', async () => {
    const asTyped = fakeCore();
    await new ScopedMedicalCore(asTyped.core, 'all').search(
      lookup('Красота и медицина пневмония', { sourceNames: false }),
    );
    expect(asTyped.search.mock.calls[0]?.[0].query).toBe('Красота и медицина пневмония');
    expect(asTyped.search.mock.calls[0]?.[0].filters.documentIds).toBeUndefined();

    const clinical = fakeCore();
    await new ScopedMedicalCore(clinical.core, 'diagnosis').search(
      lookup('Красота и медицина пневмония', { analysisMode: 'clinical' }),
    );
    expect(clinical.search.mock.calls[0]?.[0].query).toBe('Красота и медицина пневмония');
  });

  it('leaves a query that names no source untouched', async () => {
    const base = fakeCore();
    const result = await new ScopedMedicalCore(base.core, 'all').search(lookup('пневмония'));

    expect(base.search.mock.calls[0]?.[0].filters.documentIds).toBeUndefined();
    expect(result.ok && result.value.sourceScope).toBeUndefined();
  });
});
