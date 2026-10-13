import { PORTABLE_HASH_PROFILE, PortableHashEmbedder } from '@localmed/search-semantic';
import { InMemoryMedicalStore } from '@localmed/storage';
import { CORE_SLICE, CORE_SLICE_PACK } from '@localmed/test-fixtures';
import { afterEach, describe, expect, it } from 'vitest';

import { type CreateMedicalCoreOptions, createMedicalCore } from '../src/create-medical-core';

// Roadmap items 5/14: a description lookup in «Все» also gets recommendations found by meaning.
const cores: ReturnType<typeof createMedicalCore>[] = [];
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
});

function createCore(
  embedder?: CreateMedicalCoreOptions['embedder'],
  descriptionRecommendations?: boolean,
) {
  const core = createMedicalCore({
    store: new InMemoryMedicalStore(),
    seed: CORE_SLICE_PACK,
    platform: 'test',
    ...(embedder ? { embedder } : {}),
    ...(descriptionRecommendations === undefined ? {} : { descriptionRecommendations }),
  });
  cores.push(core);
  return core;
}

const lookup = (core: ReturnType<typeof createMedicalCore>, query: string) =>
  core.search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    limit: 10,
    includeSuggestions: false,
  });

const DESCRIPTION = 'боль переместилась из околопупочной области вправо вниз, была рвота';

const hashEmbedder = () => new PortableHashEmbedder(PORTABLE_HASH_PROFILE);
const ids = (groups: readonly { documentId: string }[]) => groups.map((group) => group.documentId);

describe('description recommendations (roadmap items 5/14)', () => {
  it('puts the recommendations found by meaning behind the first lexical group', async () => {
    const on = await lookup(createCore(hashEmbedder()), DESCRIPTION);
    const off = await lookup(createCore(hashEmbedder(), false), DESCRIPTION);
    if (!on.ok || !off.ok) throw new Error('search failed');
    const added = on.value.descriptionRecommendations;
    expect(added?.status).toBe('added');
    if (added?.status !== 'added') return;
    expect(added.documentIds.length).toBeGreaterThan(0);
    expect(on.value.groups[0]?.documentId).toBe(off.value.groups[0]?.documentId);
    expect(ids(on.value.groups).slice(1, 1 + added.documentIds.length)).toEqual(added.documentIds);
    expect(ids(off.value.groups)).not.toEqual(expect.arrayContaining(added.documentIds));
    expect(off.value.descriptionRecommendations).toBeUndefined();
  });

  it('reports a missing model instead of searching again', async () => {
    const base = hashEmbedder();
    const missing = {
      profile: base.profile,
      embedQuery: () => Promise.reject(new Error('semantic-model-not-installed')),
    };
    const response = await lookup(createCore(missing), DESCRIPTION);
    const off = await lookup(createCore(hashEmbedder(), false), DESCRIPTION);
    if (!response.ok || !off.ok) throw new Error('search failed');
    expect(response.value.descriptionRecommendations).toEqual({ status: 'model-missing' });
    expect(ids(response.value.groups)).toEqual(ids(off.value.groups));
  });

  it('leaves names, one-word queries and other modes alone', async () => {
    const core = createCore(hashEmbedder());
    for (const query of ['Острый аппендицит', 'аппендицит', 'J18.9']) {
      const response = await lookup(core, query);
      if (!response.ok) throw new Error('search failed');
      expect(response.value.descriptionRecommendations).toBeUndefined();
    }
    const hybrid = await core.search({
      query: DESCRIPTION,
      mode: 'hybrid',
      analysisMode: 'lookup',
      limit: 10,
      includeSuggestions: false,
    });
    if (!hybrid.ok) throw new Error('search failed');
    expect(hybrid.value.descriptionRecommendations).toBeUndefined();
    expect(CORE_SLICE.appendicitis).toBe('kr.rf.64_2');
  });
});
