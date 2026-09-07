import { readFile } from 'node:fs/promises';

import { embedPortableText, PORTABLE_HASH_PROFILE } from '@localmed/search-semantic';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SQLITE_WASM_DESERIALIZE_MAX_BYTES, SqliteMedicalStore } from '../src/index';

const stores: SqliteMedicalStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe('SqliteMedicalStore', () => {
  it('projects identities and ranking fields without unrelated metadata', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    const metadata = {
      declaredAliases: ['название'],
      navigationAliases: ['синоним'],
      catalogFamily: 'clinical',
      ageGroups: ['children'],
      entityType: 'disease',
      contentMode: 'module-pointer',
      interactiveAssessmentId: 'assessment',
      interactiveCalculatorId: 'calculator',
      calculationRequired: true,
      notLegalAdvice: true,
    };
    const seed = {
      ...DEMO_CONTENT_PACK,
      documents: DEMO_CONTENT_PACK.documents.map((document) => ({
        ...document,
        metadata: { ...metadata, unrelated: 'x'.repeat(4096) },
      })),
    };
    await store.initialize(seed);
    const identities = await store.listDocumentIdentities();
    expect(identities).toHaveLength(seed.documents.length);
    expect(identities).toContainEqual({
      id: seed.documents[0]?.id,
      versionId: seed.documents[0]?.version.id,
    });
    const projected = await store.listSearchDocuments();
    expect(projected).toHaveLength(seed.documents.length);
    expect(projected.every((document) => Object.keys(document).length === 3)).toBe(true);
    for (const document of projected) expect(document.metadata).toEqual(metadata);
    expect((await store.listDocuments())[0]?.metadata['unrelated']).toHaveLength(4096);
  });

  it('rejects an empty database that has no schema_version metadata', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    await expect(store.initialize()).rejects.toThrow('schema_version is invalid');
  });

  it('loads the compiled content seed and verifies FTS5 integrity', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    const health = await store.initialize(DEMO_CONTENT_PACK);
    const integrity = await store.inspectIntegrity();
    expect(health.documentCount).toBe(3);
    expect(health.fts5Available).toBe(true);
    expect(health).toMatchObject({
      backend: 'sqlite-wasm',
      persistent: false,
      installation: 'memory',
      sizeBytes: null,
    });
    expect(integrity).toMatchObject({
      integrity: 'ok',
      foreignKeyViolations: 0,
      chunkCount: 15,
      ftsRowCount: 15,
    });
  });

  it('opens a precompiled SQLite content pack without replaying the JSON seed', async () => {
    const databaseBytes = await readFile('packages/test-fixtures/data/rf-public-pilot.db');
    const store = await SqliteMedicalStore.createFromBytes(new Uint8Array(databaseBytes));
    stores.push(store);
    const health = await store.initialize();
    const documents = await store.listDocuments();
    expect(health.documentCount).toBe(15);
    expect(health.schemaVersion).toBe(2);
    expect(documents).toHaveLength(15);
    expect(documents.every((document) => document.title.length > 0)).toBe(true);
  });

  it('does not mutate a precompiled pack that predates tool tables', async () => {
    const databaseBytes = await readFile('packages/test-fixtures/data/rf-public-pilot.db');
    const store = await SqliteMedicalStore.createFromBytes(new Uint8Array(databaseBytes));
    stores.push(store);
    const database = (
      store as unknown as { readonly database: { readonly exec: (sql: string) => void } }
    ).database;
    const exec = vi.spyOn(database, 'exec');

    await store.initialize();

    expect(exec.mock.calls.some(([sql]) => sql.includes('CREATE TABLE'))).toBe(false);
    expect(await store.listToolDefinitions()).toEqual([]);
  });

  it('finds a colloquial respiratory case through a generated FTS query', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    await store.initialize(DEMO_CONTENT_PACK);
    const results = await store.search({
      ftsQuery: '"тахипноэ"* OR "лихорадка"*',
      terms: ['тахипноэ', 'лихорадка'],
      filters: {},
      limit: 10,
    });
    expect(results[0]?.document.id).toBe('kr.demo.pediatrics.pneumonia');
  });

  it('limits lexical FTS candidates before hydrating full search rows', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    await store.initialize(DEMO_CONTENT_PACK);
    const database = (
      store as unknown as { readonly database: { readonly exec: (sql: string) => void } }
    ).database;
    const exec = vi.spyOn(database, 'exec');

    await expect(
      store.search({
        ftsQuery: '"тахипноэ"*',
        terms: ['тахипноэ'],
        filters: {},
        limit: 1,
      }),
    ).resolves.toHaveLength(1);

    const sqlCalls = exec.mock.calls.map(([sql]) => sql);
    const candidateIndex = sqlCalls.findIndex((sql) =>
      sql.includes('SELECT chunks_fts.chunk_id AS chunk_id'),
    );
    const hydrationIndex = sqlCalls.findIndex(
      (sql) => sql.includes('c.original_text') && sql.includes('WHERE c.id IN'),
    );
    expect(candidateIndex).toBeGreaterThanOrEqual(0);
    expect(hydrationIndex).toBe(candidateIndex + 1);
    expect(sqlCalls[candidateIndex]).not.toContain('c.original_text');
    expect(sqlCalls[hydrationIndex]).toContain('c.original_text');
  });

  it('filters by a large documentIds list without exhausting bound parameters', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    await store.initialize(DEMO_CONTENT_PACK);
    const paddedDocumentIds = [
      ...Array.from({ length: 500 }, (_, index) => `nonexistent-document-${index}`),
      'kr.demo.pediatrics.pneumonia',
    ];
    const results = await store.search({
      ftsQuery: '"тахипноэ"* OR "лихорадка"*',
      terms: ['тахипноэ', 'лихорадка'],
      filters: { documentIds: paddedDocumentIds },
      limit: 10,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((hit) => hit.document.id === 'kr.demo.pediatrics.pneumonia')).toBe(true);

    const excluded = await store.search({
      ftsQuery: '"тахипноэ"* OR "лихорадка"*',
      terms: ['тахипноэ', 'лихорадка'],
      filters: { documentIds: ['kr.demo.surgery.appendicitis'] },
      limit: 10,
    });
    expect(excluded).toHaveLength(0);
  });

  it('applies specialty metadata filters before lexical and vector limits', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    await store.initialize(DEMO_CONTENT_PACK);

    const lexical = await store.search({
      ftsQuery: '"аппендицит"*',
      terms: ['аппендицит'],
      filters: { specialties: ['surgery'] },
      limit: 1,
    });
    expect(lexical).toHaveLength(1);
    expect(lexical[0]?.document.specialties).toContain('surgery');

    const excludedLexical = await store.search({
      ftsQuery: '"аппендицит"*',
      terms: ['аппендицит'],
      filters: { specialties: ['obstetrics'] },
      limit: 1,
    });
    expect(excludedLexical).toHaveLength(0);

    const query = embedPortableText('боль справа внизу живота и рвота');
    const vector = await store.searchVector({
      profileId: query.profileId,
      vector: query.values,
      norm: query.norm,
      filters: { specialties: ['surgery'] },
      limit: 1,
    });
    expect(vector).toHaveLength(1);
    expect(vector[0]?.document.specialties).toContain('surgery');

    const excludedVector = await store.searchVector({
      profileId: query.profileId,
      vector: query.values,
      norm: query.norm,
      filters: { specialties: ['obstetrics'] },
      limit: 1,
    });
    expect(excludedVector).toHaveLength(0);
  });

  it('rejects deserializing a content pack larger than the wasm heap budget', async () => {
    await expect(
      SqliteMedicalStore.createFromBytes({
        byteLength: SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1,
      } as Uint8Array),
    ).rejects.toThrow(
      `Cannot deserialize SQLite content pack into WASM (${SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1} bytes).`,
    );
  });

  it('loads embedding profiles and performs an exact local vector scan', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    await store.initialize(DEMO_CONTENT_PACK);
    const profiles = await store.listEmbeddingProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.id).toBe(PORTABLE_HASH_PROFILE.id);

    const query = embedPortableText('боль справа внизу живота и рвота');
    const results = await store.searchVector({
      profileId: query.profileId,
      vector: query.values,
      norm: query.norm,
      filters: {},
      limit: 5,
    });
    expect(results[0]?.document.id).toBe('kr.demo.surgery.appendicitis');
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it('applies document and section filters inside the vector candidate scan', async () => {
    const store = await SqliteMedicalStore.create();
    stores.push(store);
    await store.initialize(DEMO_CONTENT_PACK);
    const query = embedPortableText('боль справа внизу живота и рвота');
    const request = {
      profileId: query.profileId,
      vector: query.values,
      norm: query.norm,
      filters: {},
      limit: 5,
    };

    const scoped = await store.searchVector({
      ...request,
      filters: { documentIds: ['kr.demo.surgery.appendicitis'] },
    });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((hit) => hit.document.id === 'kr.demo.surgery.appendicitis')).toBe(true);

    const otherDocument = await store.searchVector({
      ...request,
      filters: { documentIds: ['kr.demo.pediatrics.pneumonia'] },
    });
    expect(otherDocument.length).toBeGreaterThan(0);
    expect(otherDocument.every((hit) => hit.document.id === 'kr.demo.pediatrics.pneumonia')).toBe(
      true,
    );

    const sectionScoped = await store.searchVector({
      ...request,
      filters: { documentIds: ['kr.demo.surgery.appendicitis'], sectionTypes: ['diagnostics'] },
    });
    for (const hit of sectionScoped) {
      expect(hit.section.sectionType).toBe('diagnostics');
    }
  });
});
