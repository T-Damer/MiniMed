import { readFile } from 'node:fs/promises';

import { embedPortableText, PORTABLE_HASH_PROFILE } from '@localmed/search-semantic';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteMedicalStore } from '../src/index';

const stores: SqliteMedicalStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe('SqliteMedicalStore', () => {
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
    const bytes = new Uint8Array(await readFile('apps/app/public/content/core-demo.db'));
    const store = await SqliteMedicalStore.createFromBytes(bytes);
    stores.push(store);
    const health = await store.initialize();
    expect(health.documentCount).toBe(3);
    const results = await store.search({
      ftsQuery: '"аппендицит"*',
      terms: ['аппендицит'],
      filters: {},
      limit: 5,
    });
    expect(results[0]?.document.id).toBe('kr.demo.surgery.appendicitis');
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
});
