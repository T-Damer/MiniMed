import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';
import { describe, expect, it, vi } from 'vitest';

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

function fixtureRow() {
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
  } satisfies NativeSqlRow;
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

    if (options.sql.includes('current_version_id FROM documents')) {
      const row = fixtureRow();
      return { rows: [{ id: row.id, current_version_id: row.version_id }] };
    }
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
  it('caches ranking fields separately from the full document catalog until close', async () => {
    const plugin = new FakeNativePlugin();
    const store = createStore(plugin);
    await store.initialize();
    const documents = await store.listSearchDocuments();
    expect(documents[0]).toEqual({
      id: fixtureRow().id,
      sourceType: fixtureRow().source_type,
      metadata: JSON.parse(String(fixtureRow().metadata_json)),
    });
    expect(await store.listSearchDocuments()).toBe(documents);
    expect(plugin.calls).toHaveLength(1);
    expect(plugin.calls[0]?.sql).toContain("json_type(metadata_json, '$.notLegalAdvice') = 'true'");
    expect(plugin.calls[0]?.sql).not.toContain('source_checksum');
    await store.close();
    await store.initialize();
    await store.listSearchDocuments();
    expect(plugin.calls).toHaveLength(2);
    await store.close();
  });

  it('retains source kind and ICD code for navigation filters', async () => {
    const plugin = new FakeNativePlugin();
    const store = createStore(plugin);
    await store.initialize();
    await store.listNavigationDocuments();
    expect(plugin.calls[0]?.sql).toContain("json_extract(d.metadata_json, '$.sourceType')");
    expect(plugin.calls[0]?.sql).toContain("json_extract(d.metadata_json, '$.mkbCode')");
    await store.close();
  });

  it('reads document identities without metadata for composition validation', async () => {
    const plugin = new FakeNativePlugin();
    const query = vi
      .spyOn(plugin, 'query')
      .mockResolvedValue({ rows: [{ id: 'document', current_version_id: 'version' }] });
    const store = createStore(plugin);
    await store.initialize();
    expect(await store.listDocumentIdentities()).toEqual([
      { id: 'document', versionId: 'version' },
    ]);
    expect(query).toHaveBeenCalledWith({
      sql: 'SELECT id, current_version_id FROM documents ORDER BY title COLLATE NOCASE, id',
    });
  });

  it('pages the entire immutable catalog and shares it until the store closes', async () => {
    const plugin = new FakeNativePlugin();
    const rows = Array.from({ length: 2050 }, (_, index) => ({
      ...fixtureRow(),
      id: `document-${String(index).padStart(4, '0')}`,
      metadata_json: json({ retained: 'x'.repeat(2048) }),
    }));
    const query = vi.spyOn(plugin, 'query').mockImplementation(async (options) => {
      if (!options.argsJson)
        return { rows: rows.map((row) => ({ id: row.id, current_version_id: row.version_id })) };
      const [encodedIds] = JSON.parse(options.argsJson) as [string];
      const ids = JSON.parse(encodedIds) as string[];
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThanOrEqual(1024);
      expect(options.sql).not.toContain('OFFSET');
      return { rows: rows.filter((row) => ids.includes(row.id)) };
    });
    const store = createStore(plugin);
    await store.initialize();
    const [first, second] = await Promise.all([store.listDocuments(), store.listDocuments()]);
    expect(first).toHaveLength(2050);
    expect(new Set(first.map((row) => row.id)).size).toBe(2050);
    expect(first.at(-1)?.metadata['retained']).toBe('x'.repeat(2048));
    expect(second).toBe(first);
    expect(query).toHaveBeenCalledTimes(4);
    await store.close();
    await store.initialize();
    expect(await store.listDocuments()).toHaveLength(2050);
    expect(query).toHaveBeenCalledTimes(8);
  });

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
    expect(JSON.parse(candidateCall?.argsJson ?? '[]')).toEqual(['"тахипноэ"* OR "лихорадка"*', 5]);
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
      1,
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

describe('native open lifetime', () => {
  it('shares one acquisition for concurrent initialize calls on the same adapter', async () => {
    const plugin = new FakeNativePlugin();
    const adapter = createStore(plugin);
    await Promise.all([adapter.initialize(), adapter.initialize(), adapter.initialize()]);
    expect(plugin.openCount).toBe(1);
    await adapter.close();
    expect(plugin.closeCount).toBe(1);
  });

  it('waits for a delayed native open before closing and allows a clean re-open', async () => {
    const plugin = new FakeNativePlugin();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalOpen = plugin.openPack.bind(plugin);
    const open = vi.spyOn(plugin, 'openPack').mockImplementationOnce(async () => {
      await gate;
      return originalOpen();
    });
    const adapter = createStore(plugin);
    const opening = adapter.initialize();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const closing = adapter.close();
    expect(plugin.closeCount).toBe(0);
    release?.();
    await opening;
    await closing;
    expect(plugin.openCount).toBe(1);
    expect(plugin.closeCount).toBe(1);
    await adapter.initialize();
    expect(plugin.openCount).toBe(2);
    await adapter.close();
    expect(plugin.closeCount).toBe(2);
  });

  it('does not retain a failed opening promise when retrying', async () => {
    const plugin = new FakeNativePlugin();
    vi.spyOn(plugin, 'openPack').mockRejectedValueOnce(new Error('FTS5 unavailable'));
    const adapter = createStore(plugin);
    await expect(adapter.initialize()).rejects.toThrow('FTS5 unavailable');
    await adapter.close();
    await expect(adapter.initialize()).resolves.toMatchObject({ fts5Available: true });
    await adapter.close();
  });
});
