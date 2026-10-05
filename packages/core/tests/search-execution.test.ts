import { createMedicalCore } from '@localmed/core';
import type { LexicalHit, LexicalSearchRequest } from '@localmed/storage';
import { InMemoryMedicalStore } from '@localmed/storage';
import { CORE_SLICE_PACK } from '@localmed/test-fixtures';
import { expect, it, vi } from 'vitest';

class ObservedStore extends InMemoryMedicalStore {
  public aliasReads = 0;
  public searchCalls = 0;
  public maxConcurrentSearches = 0;
  public searchRequests: LexicalSearchRequest[] = [];
  private concurrentSearches = 0;

  public override async listAliases() {
    this.aliasReads += 1;
    return super.listAliases();
  }

  public override async search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    this.searchCalls += 1;
    this.searchRequests.push(request);
    this.concurrentSearches += 1;
    this.maxConcurrentSearches = Math.max(this.maxConcurrentSearches, this.concurrentSearches);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      return await super.search(request);
    } finally {
      this.concurrentSearches -= 1;
    }
  }
}

it('uses one lexical branch for source lookup without interpreting a clinical case', async () => {
  const store = new ObservedStore();
  const core = createMedicalCore({ store, seed: CORE_SLICE_PACK, platform: 'test' });
  try {
    await core.initialize();
    const documentReads = vi.spyOn(store, 'listDocuments');
    const navigation = await core.listNavigationDocuments?.();
    expect(navigation?.ok).toBe(true);
    const readsBeforeSearch = documentReads.mock.calls.length;
    const result = await core.search({
      query: 'ребёнок 5 лет кашель пневмония',
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.length).toBeGreaterThan(0);
    // One analysis branch; the audience word adds a single title-only follow-up query for the
    // subject and the audience together in a title.
    expect(result.value.analysis.branches).toHaveLength(1);
    expect(store.searchCalls).toBe(2);
    expect(
      store.searchRequests.filter((request) => !request.ftsQuery.startsWith('title :')),
    ).toHaveLength(1);
    expect(store.searchRequests.every((request) => request.diversifyDocuments === true)).toBe(true);
    expect(documentReads).toHaveBeenCalledTimes(readsBeforeSearch);
    expect(result.value.analysis.facts).toEqual([]);
    expect(result.value.analysis.suggestions).toEqual([]);
    expect(result.value.analysis.clinicalContext).toBeUndefined();
    expect(result.value.diagnostics.semantic.status).toBe('disabled');
  } finally {
    await core.close();
  }
});

it('runs a single store query for a lookup that names no audience', async () => {
  const store = new ObservedStore();
  const core = createMedicalCore({ store, seed: CORE_SLICE_PACK, platform: 'test' });
  try {
    await core.initialize();
    const result = await core.search({
      query: 'кашель пневмония',
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    expect(result.ok).toBe(true);
    expect(store.searchCalls).toBe(1);
  } finally {
    await core.close();
  }
});

it('keeps exact subject titles through the merged chunk cutoff for document ranking', async () => {
  const store = new InMemoryMedicalStore();
  const core = createMedicalCore({
    store,
    seed: {
      ...CORE_SLICE_PACK,
      aliases: [{ id: 'sepsis', alias: 'сепсис', canonicalTerm: 'инфекция', weight: 1 }],
    },
    platform: 'test',
  });
  try {
    await core.initialize();
    const [template] = await store.search({
      ftsQuery: 'кашель',
      terms: ['кашель'],
      filters: {},
      limit: 1,
    });
    if (!template) throw new Error('Missing fixture hit');
    const target: LexicalHit = {
      ...template,
      document: { ...template.document, id: 'target', title: 'Сепсис' },
      chunk: { ...template.chunk, id: 'target-chunk', originalText: 'Сепсис' },
      rank: 0.01,
    };
    vi.spyOn(store, 'search').mockImplementation(async (request) => {
      const hits = Array.from(
        { length: request.limit },
        (_, index): LexicalHit => ({
          ...template,
          document: { ...template.document, id: 'long-document', title: 'Обзор инфекций' },
          chunk: { ...template.chunk, id: `chunk-${index}`, originalText: 'Инфекция' },
          rank: 1,
        }),
      );
      return request.terms.length === 1 ? [...hits.slice(1), target] : hits;
    });
    const response = await core.search({
      query: 'документы по заболеванию сепсис',
      mode: 'lexical',
      filters: {},
      limit: 1,
      includeSuggestions: false,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.diagnostics.candidateCount).toBeGreaterThan(50);
    expect(response.value.groups.map((group) => group.documentId)).toEqual(['target']);
  } finally {
    await core.close();
  }
});

it.each([undefined, 'clinical'] as const)(
  'caches aliases and retains bounded clinical branch context in mode %s',
  async (analysisMode) => {
    const store = new ObservedStore();
    const core = createMedicalCore({ store, seed: CORE_SLICE_PACK, platform: 'test' });
    await core.initialize();

    const query = 'ребенок 3 года температура 39 кашель одышка анализ крови';
    await core.analyzeQuery({ query, includeSuggestions: false });
    const result = await core.search({
      query,
      mode: 'lexical',
      analysisMode,
      filters: {},
      limit: 5,
      includeSuggestions: false,
    });

    expect(result.ok).toBe(true);
    expect(store.aliasReads).toBe(1);
    expect(store.searchCalls).toBeGreaterThan(1);
    expect(store.maxConcurrentSearches).toBeGreaterThan(1);
    expect(store.searchRequests.every((request) => request.diversifyDocuments === false)).toBe(
      true,
    );
    await core.close();
  },
);
