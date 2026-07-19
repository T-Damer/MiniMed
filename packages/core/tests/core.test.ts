import { PORTABLE_HASH_PROFILE, PortableHashEmbedder } from '@localmed/search-semantic';
import { InMemoryMedicalStore } from '@localmed/storage';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { createMedicalCore } from '../src/create-medical-core';

import { createInMemoryMedicalCore } from '../src/index';

const cores: ReturnType<typeof createInMemoryMedicalCore>[] = [];

afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
});

describe('MedicalCore', () => {
  it('initializes a portable core contract', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const status = await core.initialize();
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.value.documentCount).toBe(3);
  });

  it('reports the selected storage backend through core capabilities', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const capabilities = await core.getCapabilities();
    expect(capabilities.ok).toBe(true);
    if (!capabilities.ok) return;
    expect(capabilities.value).toMatchObject({
      storageBackend: 'in-memory',
      persistentStorage: false,
      storageInstallation: 'memory',
      storageSizeBytes: null,
    });
  });

  it('expands colloquial terms and returns the pneumonia section', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query: 'Ребёнок часто дышит и температурит второй день',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.pediatrics.pneumonia');
    expect(response.value.diagnostics.aliasMatches).toContain('часто дышит → тахипноэ');
  });

  it('analyzes a case without invoking a generative model', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.analyzeQuery({
      query: 'Девочка 8 лет, температура 39 второй день, часто дышит. Кашля нет.',
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.facts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(['sex', 'age', 'temperature', 'duration', 'negative-finding']),
    );
    expect(response.value.branches.length).toBeGreaterThan(0);
  });

  it('fuses several lexical branches and explains the match', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query: 'Мальчик 5 лет. Лихорадка 39 второй день, часто дышит. Сатурация 94%.',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.diagnostics.branches.length).toBeGreaterThan(1);
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.pediatrics.pneumonia');
    expect(response.value.groups[0]?.results[0]?.matchedBranches.length).toBeGreaterThan(0);
    expect(response.value.groups[0]?.results[0]?.category).toBe('clinical-picture');
  });

  it('keeps a strong clinical match above weak cross-branch overlap', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query:
        'Девочка 9 лет. Боль началась вчера около пупка, затем сместилась справа внизу живота. Дважды была рвота. ОАК: лейкоцитоз.',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.surgery.appendicitis');
    expect(response.value.groups[0]?.results[0]?.matchedBranches.length).toBeGreaterThan(0);
  });

  it('returns a stable context window around a search result', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const response = await core.search({
      query: 'справа внизу живота рвота',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(response.error.message);
    const chunkId = response.value.groups[0]?.results[0]?.chunkId;
    if (!chunkId) throw new Error('Expected a search hit.');
    const context = await core.getContext(chunkId, 1);
    expect(context.ok).toBe(true);
    if (context.ok) {
      expect(context.value.focusChunkId).toBe(chunkId);
      expect(context.value.chunks.length).toBeGreaterThan(0);
    }
  });

  it('uses compatible local vectors for automatic hybrid retrieval', async () => {
    const core = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    cores.push(core);
    const capabilities = await core.getCapabilities();
    expect(capabilities.ok).toBe(true);
    if (!capabilities.ok) return;
    expect(capabilities.value.semanticSearch).toBe(true);
    expect(capabilities.value.embeddingProfileIds).toContain(PORTABLE_HASH_PROFILE.id);

    const response = await core.search({
      query: 'Боль переместилась из околопупочной области вправо вниз, была рвота',
      mode: 'auto',
      filters: {},
      limit: 10,
      includeSuggestions: true,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.modeUsed).toBe('hybrid');
    expect(response.value.diagnostics.semantic.status).toBe('used');
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.surgery.appendicitis');
    expect(response.value.groups[0]?.results[0]?.semanticScore).not.toBeNull();
  });

  it('falls back to lexical search on an incompatible embedding profile', async () => {
    const store = new InMemoryMedicalStore();
    const incompatibleEmbedder = new PortableHashEmbedder({
      ...PORTABLE_HASH_PROFILE,
      id: 'localmed.incompatible.16.v1',
      dimensions: 16,
      fingerprint: 'incompatible:16',
    });
    const core = createMedicalCore({
      store,
      seed: DEMO_CONTENT_PACK,
      platform: 'test',
      embedder: incompatibleEmbedder,
    });
    cores.push(core);

    const response = await core.search({
      query: 'ребенок часто дышит и температурит',
      mode: 'hybrid',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.modeUsed).toBe('lexical');
    expect(response.value.diagnostics.semantic).toMatchObject({
      status: 'fallback',
      fallbackReason: 'embedding-profile-mismatch',
    });
    expect(response.value.groups[0]?.documentId).toBe('kr.demo.pediatrics.pneumonia');
  });
});
