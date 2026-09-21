import { type DefinitionReferenceRequest, DefinitionReferenceRequestSchema } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MultiMedicalStore } from '../src/multi-medical-store';
import type { MedicalStore, StorageHealth } from '../src/ports';

const scope = { moduleId: 'reference.test', editionId: 'edition.test' };
function fixture() {
  const health: StorageHealth = { schemaVersion: 2, sqliteVersion: 'test', fts5Available: true, contentPackIds: ['core.test'], documentCount: 0, backend: 'in-memory', persistent: false, installation: 'memory', sizeBytes: 0 };
  const base = {
    initialize: vi.fn(async () => health), getHealth: vi.fn(async () => health),
    listDocuments: vi.fn(async () => []), listDocumentIdentities: vi.fn(async () => []),
    listAliases: vi.fn(async () => []), listEmbeddingProfiles: vi.fn(async () => []), close: vi.fn(async () => {}),
  } as unknown as MedicalStore;
  const forbidden = vi.fn(async () => { throw new Error('Whole reference corpus must not be read.'); });
  const reference = {
    initialize: vi.fn(async () => ({ ...health, schemaVersion: 7 })), getHealth: forbidden,
    listDocuments: forbidden, listDocumentIdentities: forbidden, listAliases: forbidden,
    listEmbeddingProfiles: forbidden, close: vi.fn(async () => {}),
    reference: vi.fn(async (request: DefinitionReferenceRequest) => request.op === 'status'
      ? { op: 'status' as const, editionId: scope.editionId, entries: 3 }
      : { op: 'search' as const, hits: [] }),
  } as unknown as MedicalStore;
  const store = new MultiMedicalStore([
    { moduleId: 'core.test', store: base, required: true },
    { moduleId: scope.moduleId, store: reference, definitionReference: { editionId: scope.editionId, entries: 3 } },
  ]);
  return { store, reference, base, forbidden };
}

describe('isolated reference capability on the existing mounted owner', () => {
  it('keeps a schema-7 reference out of schema-2 ordinary clinical projections', async () => {
    const { store, forbidden } = fixture();
    await store.initialize();
    expect((await store.getHealth()).schemaVersion).toBe(2);
    expect(await store.listDocuments()).toEqual([]);
    expect(await store.reference({ ...scope, op: 'search', query: 'term' })).toEqual({ op: 'search', hits: [] });
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('does not forward an unknown module or stale edition', async () => {
    const { store, reference } = fixture(); await store.initialize();
    const count = vi.mocked(reference.reference!).mock.calls.length;
    expect(await store.reference({ ...scope, moduleId: 'other.test', op: 'search', query: 'term' })).toEqual({ op: 'unavailable' });
    expect(await store.reference({ ...scope, editionId: 'old.edition', op: 'search', query: 'term' })).toEqual({ op: 'unavailable' });
    expect(vi.mocked(reference.reference!).mock.calls).toHaveLength(count);
  });
  it('honors disable, enable and removal without a second owner', async () => {
    const { store, reference } = fixture(); await store.initialize();
    await store.setEnabled(scope.moduleId, false);
    expect(await store.reference({ ...scope, op: 'status' })).toEqual({ op: 'unavailable' });
    await store.setEnabled(scope.moduleId, true);
    expect((await store.reference({ ...scope, op: 'status' })).op).toBe('status');
    await store.removeMount(scope.moduleId);
    expect(await store.reference({ ...scope, op: 'status' })).toEqual({ op: 'unavailable' });
    expect(reference.close).toHaveBeenCalledTimes(1);
    await store.close(); expect(reference.close).toHaveBeenCalledTimes(1);
  });
  it('rejects capability use after closing the owning store', async () => {
    const { store, reference, base } = fixture(); await store.initialize(); await store.close();
    await expect(store.reference({ ...scope, op: 'status' })).rejects.toThrow('not initialized');
    expect(reference.close).toHaveBeenCalledTimes(1); expect(base.close).toHaveBeenCalledTimes(1);
  });
  it('does not relax normal clinical schema compatibility', async () => {
    const { base } = fixture();
    const other = { ...base, getHealth: async () => ({ ...(await base.getHealth()), schemaVersion: 7, contentPackIds: ['other'] }) };
    const store = new MultiMedicalStore([{ moduleId: 'core', store: base }, { moduleId: 'other', store: other }]);
    await expect(store.initialize()).rejects.toThrow('Incompatible module schema');
  });
  it.each([
    { op: 'search', query: 'a', limit: 21 }, { op: 'search', query: 'a'.repeat(2049) },
    { op: 'search', query: 'a\0b' }, { op: 'text', id: 'entry', chunkId: 'block', offset: -1 },
    { op: 'text', id: 'entry', chunkId: 'block', offset: 0.5 },
    { op: 'status', sql: 'SELECT * FROM chunks' },
  ])('rejects unbounded or non-domain input %j', (request) => {
    expect(DefinitionReferenceRequestSchema.safeParse({ ...scope, ...request }).success).toBe(false);
  });
});
