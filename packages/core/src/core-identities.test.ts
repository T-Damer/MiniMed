import { type CoreIdentityHit, SearchRequestSchema } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';
import { InMemoryMedicalStore } from '@localmed/storage';
import { CORE_SLICE_PACK } from '@localmed/test-fixtures';
import { expect, it } from 'vitest';

it('keeps ambiguous stopword identities outside FTS, obeys filters and propagates errors', async () => {
  const store = new InMemoryMedicalStore();
  const hits: CoreIdentityHit[] = ['meaning-a', 'meaning-b'].map((entityId) => ({
    name: 'НА',
    title: entityId,
    kind: 'abbreviation',
    coverage: 'needs-definition',
    target: {
      type: 'definition',
      entityId,
      moduleId: 'reference',
      moduleVersion: '1',
      editionId: 'edition',
    },
  }));
  Object.assign(store, {
    lookupCoreIdentities: async (query: string) => (query === 'НА' ? hits : []),
  });
  const core = createMedicalCore({ store, seed: CORE_SLICE_PACK, platform: 'test' });
  const request = {
    ...SearchRequestSchema.parse({ query: 'НА' }),
    analysisMode: 'lookup' as const,
  };
  const response = await core.search(request);
  expect(response.ok).toBe(true);
  if (!response.ok) throw response.error;
  expect(response.value.identities).toEqual(hits);
  expect(response.value.groups).toEqual([]);
  expect(response.value.diagnostics.candidateCount).toBe(0);
  for (const filters of [
    { documentIds: ['other'] },
    { specialties: ['pediatrics'] },
    { sectionTypes: ['definition'] },
    { ageGroups: ['children'] },
  ]) {
    const filtered = await core.search({ ...request, filters });
    expect(filtered.ok).toBe(false);
    if (!filtered.ok) expect(filtered.error.code).toBe('INVALID_REQUEST');
  }
  expect((await core.search({ ...request, query: 'И' })).ok).toBe(false);
  expect((await core.search({ ...request, analysisMode: 'clinical' })).ok).toBe(false);
  Object.assign(store, {
    lookupCoreIdentities: async () => {
      throw new Error('identity failure');
    },
  });
  const failed = await core.search(request);
  expect(failed.ok).toBe(false);
  if (!failed.ok) expect(failed.error.message).toBe('identity failure');
  await core.close();
});
