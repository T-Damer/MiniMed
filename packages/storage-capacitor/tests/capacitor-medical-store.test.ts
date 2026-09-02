import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';
import { describe, expect, it } from 'vitest';

import {
  CapacitorMedicalStore,
  type LocalMedDatabasePlugin,
  type NativeQueryOptions,
  type NativeSqlRow,
  type NativeVectorSearchOptions,
} from '../src/index';

function json(value: unknown): string {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Unable to serialize fixture value.');
  return result;
}

function fixtureRow(): NativeSqlRow {
  const document = DEMO_CONTENT_PACK.documents.find(
    (item) => item.id === 'kr.demo.pediatrics.pneumonia',
  );
  const section = document?.sections.find((item) => item.sectionType === 'clinical-picture');
  const chunk = section?.chunks[0];
  if (!document || !section || !chunk) throw new Error('Expected pneumonia fixture content.');
  return {
    id: document.id,
    content_pack_id: DEMO_CONTENT_PACK.manifest.id,
    title: document.title,
    short_title: document.shortTitle,
    source_type: document.sourceType,
    status: document.status,
    specialty_json: json(document.specialties),
    metadata_json: json(document.metadata),
    version_id: document.version.id,
    version_label: document.version.label,
    effective_from: document.version.effectiveFrom,
    effective_to: document.version.effectiveTo,
    source_checksum: document.version.sourceChecksum,
    extracted_at: document.version.extractedAt,
    section_id: section.id,
    document_version_id: document.version.id,
    parent_section_id: section.parentSectionId,
    section_title: section.title,
    normalized_title: section.normalizedTitle,
    section_type: section.sectionType,
    depth: section.depth,
    section_order_index: section.orderIndex,
    section_page_start: section.pageStart,
    section_page_end: section.pageEnd,
    section_anchor: section.anchor,
    path_json: json(section.sectionPath),
    chunk_id: chunk.id,
    chunk_order_index: chunk.orderIndex,
    original_text: chunk.originalText,
    normalized_text: chunk.normalizedText,
    chunk_page_start: chunk.pageStart,
    chunk_page_end: chunk.pageEnd,
    char_start: chunk.charStart,
    char_end: chunk.charEnd,
    previous_chunk_id: null,
    next_chunk_id: null,
    chunk_anchor: chunk.anchor,
    chunk_metadata_json: json(chunk.metadata),
    bm25_rank: -2.5,
  };
}

function fixtureChunkId(): string {
  return (fixtureRow() as NativeSqlRow & { readonly chunk_id: string }).chunk_id;
}

class FakeNativePlugin implements LocalMedDatabasePlugin {
  readonly calls: NativeQueryOptions[] = [];
  readonly vectorCalls: NativeVectorSearchOptions[] = [];
  openCount = 0;
  closeCount = 0;
  closed = false;

  async openPack() {
    this.openCount += 1;
    this.closed = false;
    return {
      schemaVersion: 2,
      sqliteVersion: '3.50.0-native-test',
      fts5Available: true,
      contentPackIds: [DEMO_CONTENT_PACK.manifest.id],
      documentCount: DEMO_CONTENT_PACK.documents.length,
      databasePath: '/test/core.db',
      copied: true,
      sizeBytes: 64_000,
    } as const;
  }

  async query(options: NativeQueryOptions) {
    if (this.closed) throw new Error('native database is closed');
    this.calls.push(options);

    if (options.sql.includes('FROM embedding_profiles')) {
      const profile = DEMO_CONTENT_PACK.embeddingProfiles[0];
      if (!profile) throw new Error('Expected a demo embedding profile.');
      return {
        rows: [
          {
            id: profile.id,
            dimensions: profile.dimensions,
            vector_format: profile.vectorFormat,
            normalization: profile.normalization,
            generator: profile.generator,
            generator_version: profile.generatorVersion,
            fingerprint: profile.fingerprint,
            metadata_json: json(profile.metadata),
          },
        ],
      };
    }

    return { rows: [fixtureRow()] };
  }

  async searchVectors(options: NativeVectorSearchOptions) {
    this.vectorCalls.push(options);
    return {
      hits: [
        {
          chunkId: fixtureChunkId(),
          score: 0.75,
        },
      ],
    };
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.closed = true;
  }
}

function createStore(plugin: FakeNativePlugin): CapacitorMedicalStore {
  return new CapacitorMedicalStore({
    plugin,
    assetPath: 'public/content/core.db',
    databaseName: 'core.db',
    expectedSha256: `sha256:${'a'.repeat(64)}`,
  });
}

describe('CapacitorMedicalStore', () => {
  it('reports a persistent native SQLite backend', async () => {
    const plugin = new FakeNativePlugin();
    const store = createStore(plugin);
    await expect(store.initialize()).resolves.toMatchObject({
      backend: 'sqlite-native',
      persistent: true,
      installation: 'copied',
      sizeBytes: 64_000,
      documentCount: 3,
      fts5Available: true,
    });
    await store.close();
    expect(plugin.closed).toBe(true);
  });

  it('keeps a shared native database open until the last store closes', async () => {
    const plugin = new FakeNativePlugin();
    const first = createStore(plugin);
    const second = createStore(plugin);

    await first.initialize();
    await second.initialize();
    expect(plugin.openCount).toBe(1);

    await first.close();
    expect(plugin.closeCount).toBe(0);
    await expect(second.listDocuments()).resolves.toHaveLength(1);

    await second.close();
    expect(plugin.closeCount).toBe(1);
  });

  it('maps native rows into the portable document contract', async () => {
    const plugin = new FakeNativePlugin();
    const store = createStore(plugin);
    await store.initialize();
    const documents = await store.listDocuments();
    expect(documents[0]).toMatchObject({
      id: 'kr.demo.pediatrics.pneumonia',
      contentPackId: DEMO_CONTENT_PACK.manifest.id,
    });
  });

  it('executes the same FTS5 query shape as the WASM store', async () => {
    const plugin = new FakeNativePlugin();
    const store = createStore(plugin);
    await store.initialize();
    const hits = await store.search({
      ftsQuery: '"тахипноэ"* OR "лихорадка"*',
      terms: ['тахипноэ', 'лихорадка'],
      filters: {},
      limit: 5,
    });
    expect(hits[0]).toMatchObject({
      document: { id: 'kr.demo.pediatrics.pneumonia' },
      rank: 2.5,
    });
    expect(plugin.calls).toHaveLength(2);
    const candidateCall = plugin.calls.at(-2);
    const hydrationCall = plugin.calls.at(-1);
    expect(candidateCall?.sql).toContain('SELECT chunks_fts.chunk_id AS chunk_id');
    expect(candidateCall?.sql).toContain('bm25(chunks_fts');
    expect(candidateCall?.sql).not.toContain('c.original_text');
    expect(JSON.parse(candidateCall?.argsJson ?? '[]')).toEqual([
      '"тахипноэ"* OR "лихорадка"*',
      50,
    ]);
    expect(hydrationCall?.sql).toContain('c.original_text');
    expect(hydrationCall?.sql).not.toContain('bm25(chunks_fts');
    expect(JSON.parse(hydrationCall?.argsJson ?? '[]')).toEqual([fixtureChunkId()]);
  });

  it('pushes specialty and age-group filters into native SQL and vector search', async () => {
    const plugin = new FakeNativePlugin();
    const store = createStore(plugin);
    await store.initialize();

    await store.search({
      ftsQuery: '"тахипноэ"*',
      terms: ['тахипноэ'],
      filters: { specialties: ['pediatrics'], ageGroups: ['children'] },
      limit: 1,
    });
    const candidateCall = plugin.calls.at(-2);
    expect(candidateCall?.sql).toContain('json_each(d.specialty_json)');
    expect(candidateCall?.sql).toContain("json_extract(d.metadata_json, '$.ageGroups')");
    expect(JSON.parse(candidateCall?.argsJson ?? '[]')).toEqual([
      '"тахипноэ"*',
      'pediatrics',
      'children',
      50,
    ]);

    const profile = DEMO_CONTENT_PACK.embeddingProfiles[0];
    const embedding = DEMO_CONTENT_PACK.embeddings.find(
      (item) => item.profileId === profile?.id && item.chunkId === fixtureChunkId(),
    );
    if (!profile || !embedding) throw new Error('Expected a pneumonia embedding fixture.');
    await store.searchVector({
      profileId: profile.id,
      vector: embedding.values,
      norm: embedding.norm,
      filters: { specialties: ['pediatrics'], ageGroups: ['children'] },
      limit: 1,
    });
    expect(plugin.vectorCalls.at(-1)).toMatchObject({
      specialties: ['pediatrics'],
      ageGroups: ['children'],
    });
  });

  it('loads the native embedding profile and hydrates exact vector hits', async () => {
    const plugin = new FakeNativePlugin();
    const store = createStore(plugin);
    await store.initialize();

    const profile = DEMO_CONTENT_PACK.embeddingProfiles[0];
    const embedding = DEMO_CONTENT_PACK.embeddings.find(
      (item) => item.profileId === profile?.id && item.chunkId === fixtureChunkId(),
    );
    if (!profile || !embedding) throw new Error('Expected a pneumonia embedding fixture.');

    await expect(store.listEmbeddingProfiles()).resolves.toEqual([profile]);
    await expect(
      store.searchVector({
        profileId: profile.id,
        vector: embedding.values,
        norm: embedding.norm,
        filters: {},
        limit: 5,
      }),
    ).resolves.toMatchObject([
      {
        document: { id: 'kr.demo.pediatrics.pneumonia' },
        score: 0.75,
      },
    ]);

    const vectorCall = plugin.vectorCalls[0];
    expect(vectorCall).toMatchObject({
      profileId: profile.id,
      vectorNorm: embedding.norm,
      limit: 100,
    });
    expect(Buffer.from(vectorCall?.vectorBase64 ?? '', 'base64')).toHaveLength(profile.dimensions);
  });
});
