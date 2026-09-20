import { ContentPackSeedSchema, type SearchFilters } from '@localmed/contracts';
import { normalizeForIndex } from '@localmed/search-lexical';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { InMemoryMedicalStore, type LexicalHit } from '@localmed/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMedicalCore } from './create-medical-core';
import { QueryDocumentIndex } from './query-document-index';

describe('QueryDocumentIndex', () => {
  it('separates strict titles/navigation aliases from broad declared aliases', () => {
    const index = new QueryDocumentIndex([
      {
        id: 'exact-title',
        title: 'D32.0 Оболочек головного мозга, МКБ-10',
        shortTitle: 'D32.0',
        sourceType: 'medical_reference',
        metadata: {
          declaredAliases: ['оболочки головного мозга'],
          navigationAliases: ['D32.0'],
        },
      },
      {
        id: 'broad-alias',
        title: 'Смежный документ',
        shortTitle: null,
        sourceType: 'medical_reference',
        metadata: {
          declaredAliases: ['D32.0'],
        },
      },
    ]);

    expect([...index.exactTitleIds('D32.0 Оболочек головного мозга, МКБ-10')]).toEqual([
      'exact-title',
    ]);
    expect([...index.exactNavigationAliasIds('D32.0')]).toEqual(['exact-title']);
    expect([...index.exactShortTitleIds('D32.0')]).toEqual(['exact-title']);
    expect([...index.exactIdentityIds('D32.0')]).toEqual(['exact-title']);
    expect([...index.exactAliasIds('D32.0')].toSorted()).toEqual([
      'broad-alias',
      'exact-title',
    ]);
  });

  it('normalizes strict identity surfaces consistently with lookup subjects', () => {
    const index = new QueryDocumentIndex([
      {
        id: 'jaspers',
        title: 'Критерии Ясперса',
        shortTitle: null,
        sourceType: 'medical_reference',
        metadata: {
          navigationAliases: ['ЯСПЕРС'],
        },
      },
    ]);

    expect([...index.exactNavigationAliasIds('  Ясперс  ')]).toEqual(['jaspers']);
    expect([...index.exactTitleIds('Критерии Ясперса')]).toEqual(['jaspers']);
  });
});

const IDENTITY_TITLE = 'Контрольный справочник';
const IDENTITY_SHORT_TITLE = 'Краткое имя';
const IDENTITY_ALIAS = 'Проверенное имя';

function identityFixtureSection(id: string, sectionType: string | null, texts: readonly string[]) {
  return {
    id,
    parentSectionId: null,
    title: id,
    normalizedTitle: id,
    sectionType,
    depth: 1,
    orderIndex: 0,
    pageStart: null,
    pageEnd: null,
    anchor: id,
    sectionPath: [id],
    chunks: texts.map((text, index) => ({
      id: `${id}.${index}`,
      orderIndex: index,
      originalText: text,
      normalizedText: normalizeForIndex(text),
      pageStart: null,
      pageEnd: null,
      charStart: null,
      charEnd: null,
      anchor: `${id}-anchor-${index}`,
      metadata: {},
    })),
  };
}

const IDENTITY_RETENTION_SEED = ContentPackSeedSchema.parse({
  manifest: {
    id: 'test.identity-retention',
    version: '1.0.0',
    schemaVersion: 2,
    title: 'Exact identity retention fixture',
    checksum: 'test-identity-retention',
    builtAt: '2026-09-20T00:00:00Z',
  },
  documents: [
    {
      id: 'identity',
      title: IDENTITY_TITLE,
      shortTitle: IDENTITY_SHORT_TITLE,
      sourceType: 'medical_reference',
      status: 'active',
      specialties: ['pediatrics'],
      metadata: {
        navigationAliases: [IDENTITY_ALIAS],
        declaredAliases: ['Обзорное слово'],
        ageGroups: ['children'],
        conceptId: 'test.concept.identity',
      },
      version: {
        id: 'identity.v1',
        label: '1',
        effectiveFrom: null,
        effectiveTo: null,
        sourceChecksum: 'test-source-checksum',
        extractedAt: '2026-09-20T00:00:00Z',
      },
      sections: [
        identityFixtureSection('outline', null, []),
        identityFixtureSection('definition', 'definition', ['Исходный текст справочника.']),
        identityFixtureSection('empty-treatment', 'treatment', []),
        identityFixtureSection('treatment', 'treatment', ['Исходный текст раздела.']),
        identityFixtureSection('later', 'diagnostics', ['Другой исходный текст.']),
      ].map((section, orderIndex) => ({ ...section, orderIndex })),
    },
    {
      id: 'distractor',
      title: 'Другой справочник',
      shortTitle: null,
      sourceType: 'medical_reference',
      status: 'active',
      specialties: [],
      metadata: {},
      version: {
        id: 'distractor.v1',
        label: '1',
        effectiveFrom: null,
        effectiveTo: null,
        sourceChecksum: 'test-distractor-checksum',
        extractedAt: '2026-09-20T00:00:00Z',
      },
      sections: [
        identityFixtureSection(
          'other',
          'definition',
          Array.from({ length: 50 }, (_, index) => `Другой исходный фрагмент ${index}.`),
        ),
      ],
    },
  ],
  aliases: [],
});

const retentionCores: ReturnType<typeof createMedicalCore>[] = [];
afterEach(async () => {
  await Promise.all(retentionCores.splice(0).map((core) => core.close()));
  vi.restoreAllMocks();
});

async function retentionFixture() {
  const store = new InMemoryMedicalStore();
  const embedder = new PortableHashEmbedder();
  const core = createMedicalCore({ store, embedder, seed: IDENTITY_RETENTION_SEED, platform: 'test' });
  retentionCores.push(core);
  expect((await core.initialize()).ok).toBe(true);
  return { store, embedder, core };
}

async function retentionHit(store: InMemoryMedicalStore, chunkId: string): Promise<LexicalHit> {
  const chunk = await store.getChunk(chunkId);
  if (!chunk) throw new Error(`Missing fixture chunk ${chunkId}`);
  const section = await store.getSection(chunk.sectionId);
  const document = await store.getDocumentByVersionId(chunk.documentVersionId);
  if (!section || !document) throw new Error('Incomplete retention fixture');
  return { chunk, section, document, rank: 1 };
}

describe('exact identity retention through MedicalCore', () => {
  it.each([IDENTITY_TITLE, IDENTITY_SHORT_TITLE, IDENTITY_ALIAS])(
    'finds a readable section after an empty outline for %s',
    async (query) => {
      const { store, core } = await retentionFixture();
      vi.spyOn(store, 'search').mockResolvedValue([]);
      const sections = vi.spyOn(store, 'getChunksBySection');
      const wholeDocument = vi.spyOn(store, 'getChunksByDocument');
      const response = await core.search({ query, analysisMode: 'lookup', mode: 'lexical' });
      expect(response.ok).toBe(true);
      if (!response.ok) throw response.error;
      const group = response.value.groups[0];
      expect(group?.documentId).toBe('identity');
      expect(group?.conceptId).toBe('test.concept.identity');
      const result = group?.results[0];
      expect(result?.chunkId).toBe('definition.0');
      expect(result?.anchor).toBe('definition-anchor-0');
      expect(sections.mock.calls).toEqual([['outline'], ['definition']]);
      expect(wholeDocument).not.toHaveBeenCalled();
      if (!result) throw new Error('Missing retained source result');
      const context = await core.getSearchResultContext(result);
      expect(context.ok).toBe(true);
      if (context.ok) expect(context.value.focusChunkId).toBe(result.chunkId);
    },
  );

  it('continues past empty eligible sections without crossing section filters', async () => {
    const { store, core } = await retentionFixture();
    vi.spyOn(store, 'search').mockResolvedValue([]);
    const sections = vi.spyOn(store, 'getChunksBySection');
    const response = await core.search({
      query: IDENTITY_TITLE,
      filters: { sectionTypes: ['treatment'] },
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw response.error;
    expect(response.value.groups[0]?.results[0]?.chunkId).toBe('treatment.0');
    expect(sections.mock.calls).toEqual([['empty-treatment'], ['treatment']]);
  });

  it.each<SearchFilters>([
    { documentIds: ['distractor'] },
    { specialties: ['cardiology'] },
    { ageGroups: ['adults'] },
  ])('rejects an ineligible identity before reading its sections: %j', async (filters) => {
    const { store, core } = await retentionFixture();
    vi.spyOn(store, 'search').mockResolvedValue([]);
    const sections = vi.spyOn(store, 'getSectionsByDocument');
    const response = await core.search({ query: IDENTITY_TITLE, filters });
    expect(response.ok).toBe(true);
    if (!response.ok) throw response.error;
    expect(response.value.groups).toEqual([]);
    expect(sections).not.toHaveBeenCalled();
  });

  it('does not invent a source result when all eligible sections are empty', async () => {
    const { store, core } = await retentionFixture();
    vi.spyOn(store, 'search').mockResolvedValue([]);
    vi.spyOn(store, 'getChunksBySection').mockResolvedValue([]);
    const response = await core.search({ query: IDENTITY_TITLE });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.value.groups).toEqual([]);
  });

  it('skips whitespace-only chunks but preserves the real source chunk', async () => {
    const { store, core } = await retentionFixture();
    const hit = await retentionHit(store, 'definition.0');
    const getChunks = store.getChunksBySection.bind(store);
    vi.spyOn(store, 'search').mockResolvedValue([]);
    vi.spyOn(store, 'getChunksBySection').mockImplementation(async (sectionId) =>
      sectionId === 'definition'
        ? [{ ...hit.chunk, id: 'blank', originalText: '  \n  ' }, hit.chunk]
        : getChunks(sectionId),
    );
    const response = await core.search({ query: IDENTITY_TITLE });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.value.groups[0]?.results[0]?.chunkId).toBe('definition.0');
  });

  it('propagates storage errors rather than silently losing the exact source', async () => {
    const { store, core } = await retentionFixture();
    vi.spyOn(store, 'search').mockResolvedValue([]);
    vi.spyOn(store, 'getChunksBySection').mockRejectedValue(new Error('test storage failure'));
    const response = await core.search({ query: IDENTITY_TITLE });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toBe('test storage failure');
  });

  it.each(['semantic', 'hybrid'] as const)(
    'preserves an already retrieved short-title hit through %s fusion without rehydrating',
    async (mode) => {
      const { store, embedder, core } = await retentionFixture();
      const identity = await retentionHit(store, 'definition.0');
      const others = await Promise.all(
        Array.from({ length: 50 }, (_, index) => retentionHit(store, `other.${index}`)),
      );
      vi.spyOn(store, 'search').mockResolvedValue([
        ...others.slice(0, 49),
        { ...identity, rank: 0.0001 },
      ]);
      vi.spyOn(store, 'listEmbeddingProfiles').mockResolvedValue([embedder.profile]);
      vi.spyOn(store, 'searchVector').mockResolvedValue(
        others.map((hit) => ({ ...hit, score: 1 })),
      );
      const sections = vi.spyOn(store, 'getChunksBySection');
      const response = await core.search({
        query: IDENTITY_SHORT_TITLE,
        analysisMode: 'lookup',
        mode,
        limit: 1,
      });
      expect(response.ok).toBe(true);
      if (!response.ok) throw response.error;
      expect(response.value.modeUsed).toBe(mode);
      expect(response.value.diagnostics.semantic.status).toBe('used');
      expect(response.value.groups[0]?.documentId).toBe('identity');
      expect(response.value.groups[0]?.results.map((result) => result.chunkId)).toEqual([
        'definition.0',
      ]);
      expect(sections).not.toHaveBeenCalled();
    },
  );

  it('does not hydrate an identity already provided by vector retrieval', async () => {
    const { store, embedder, core } = await retentionFixture();
    const identity = await retentionHit(store, 'definition.0');
    vi.spyOn(store, 'search').mockResolvedValue([]);
    vi.spyOn(store, 'listEmbeddingProfiles').mockResolvedValue([embedder.profile]);
    vi.spyOn(store, 'searchVector').mockResolvedValue([{ ...identity, score: 1 }]);
    const sections = vi.spyOn(store, 'getChunksBySection');
    const response = await core.search({ query: IDENTITY_TITLE, mode: 'semantic' });
    expect(response.ok).toBe(true);
    if (!response.ok) throw response.error;
    expect(response.value.groups[0]?.documentId).toBe('identity');
    expect(sections).not.toHaveBeenCalled();
  });

  it('does not inject a broad discovery alias as a strict identity', async () => {
    const { store, core } = await retentionFixture();
    vi.spyOn(store, 'search').mockResolvedValue([]);
    const response = await core.search({ query: 'Обзорное слово', analysisMode: 'lookup' });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.value.groups).toEqual([]);
  });
});
