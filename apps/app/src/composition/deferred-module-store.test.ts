import type { MedicalStore, StorageHealth } from '@localmed/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDeferredModuleStore,
  resetDeferredModuleStoresForTests,
  warmDeferredModuleStores,
} from '@/composition/deferred-module-store';
import type { ShelfFacts, ShelfFactsStore } from '@/composition/module-shelf-facts';

const HEALTH = { ok: true } as unknown as StorageHealth;
const METHODS = new Set([
  'initialize',
  'getHealth',
  'close',
  'listAliases',
  'listDocumentIdentities',
  'listNavigationDocuments',
  'listDocuments',
  'getDocument',
  'getSectionsByDocument',
  'getChunksByDocument',
  'search',
]);

function realStore() {
  const store = {
    initialize: vi.fn(async () => HEALTH),
    getHealth: vi.fn(async () => HEALTH),
    close: vi.fn(async () => undefined),
    listAliases: vi.fn(async () => [{ id: 'a' }]),
    listDocumentIdentities: vi.fn(async () => [{ id: 'd', versionId: 'v1' }]),
    listNavigationDocuments: vi.fn(async () => [{ id: 'd' }]),
    listDocuments: vi.fn(async () => [{ id: 'd', metadata: { big: true } }]),
    getDocument: vi.fn(async (id: string) => (id === 'd' ? { id } : null)),
    getSectionsByDocument: vi.fn(async () => []),
    getChunksByDocument: vi.fn(async () => []),
    search: vi.fn(async () => [{ chunk: { id: 'c' } }]),
  };
  return store as typeof store & MedicalStore;
}

function factsStore(saved = new Map<string, ShelfFacts>()): ShelfFactsStore & {
  readonly saved: Map<string, ShelfFacts>;
} {
  return {
    saved,
    load: async (file) => saved.get(file),
    save: (file, facts) => void saved.set(file, facts),
  };
}

afterEach(resetDeferredModuleStoresForTests);

describe('a large module mounted from kept facts', () => {
  it('the first start opens the file and keeps what it answered', async () => {
    const real = realStore();
    const facts = factsStore();
    const open = vi.fn(async () => real);
    const store = createDeferredModuleStore({
      key: 'k',
      facts,
      kept: undefined,
      open,
      methods: METHODS,
    });

    expect(await store.initialize()).toBe(HEALTH);
    expect(await store.listAliases()).toEqual([{ id: 'a' }]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(facts.saved.get('k')).toEqual({
      health: HEALTH,
      listings: { listAliases: [{ id: 'a' }] },
    });
  });

  it('a later start answers health and listings without opening the file', async () => {
    const real = realStore();
    const open = vi.fn(async () => real);
    const kept = { health: HEALTH, listings: { listAliases: [{ id: 'kept' }] } };
    const store = createDeferredModuleStore({
      key: 'k',
      facts: factsStore(),
      kept,
      open,
      methods: METHODS,
    });

    expect(await store.initialize()).toBe(HEALTH);
    expect(await store.getHealth()).toBe(HEALTH);
    expect(await store.listAliases()).toEqual([{ id: 'kept' }]);
    expect(open).not.toHaveBeenCalled();

    // The first call the facts cannot answer opens and initialises the file, once.
    expect(await store.search({} as never)).toEqual([{ chunk: { id: 'c' } }]);
    expect(await store.listNavigationDocuments?.()).toEqual([{ id: 'd' }]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(real.initialize).toHaveBeenCalledTimes(1);
  });

  it('never keeps the full document listing', async () => {
    const facts = factsStore();
    const store = createDeferredModuleStore({
      key: 'k',
      facts,
      kept: undefined,
      open: async () => realStore(),
      methods: METHODS,
    });
    await store.listDocuments();
    expect(Object.keys(facts.saved.get('k')?.listings ?? {})).not.toContain('listDocuments');
  });

  it('opens a cold module for the reader only when it may hold the requested document', async () => {
    const real = realStore();
    const open = vi.fn(async () => real);
    const store = createDeferredModuleStore({
      key: 'drug-module',
      facts: factsStore(),
      kept: {
        health: HEALTH,
        listings: { listDocumentIdentities: [{ id: 'd', versionId: 'v1' }] },
      },
      open,
      methods: METHODS,
    });

    expect(await store.getDocument('another-pack')).toBeNull();
    expect(await store.getSectionsByDocument('another-pack')).toEqual([]);
    expect(await store.getChunksByDocument('another-pack')).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    expect(await store.getDocument('d')).toEqual({ id: 'd' });
    expect(open).toHaveBeenCalledOnce();
    await store.close();
  });

  it('offers only the methods the real store has', () => {
    const store = createDeferredModuleStore({
      key: 'k',
      facts: factsStore(),
      kept: { health: HEALTH },
      open: async () => realStore(),
      methods: METHODS,
    });
    expect(store.scoreVectors).toBeUndefined();
    expect(store.reference).toBeUndefined();
    expect(typeof store.search).toBe('function');
  });

  it('warming opens the files mounted from facts; closing an unopened store opens nothing', async () => {
    const open = vi.fn(async () => realStore());
    const kept = { health: HEALTH };
    const first = createDeferredModuleStore({
      key: 'a',
      facts: factsStore(),
      kept,
      open,
      methods: METHODS,
    });
    const second = createDeferredModuleStore({
      key: 'b',
      facts: factsStore(),
      kept,
      open,
      methods: METHODS,
    });
    await second.close();
    await warmDeferredModuleStores();
    expect(open).toHaveBeenCalledTimes(1);
    await first.close();
  });

  it('a file that does not open forgets its kept facts', async () => {
    const facts = factsStore();
    const store = createDeferredModuleStore({
      key: 'k',
      facts,
      kept: { health: HEALTH },
      open: async () => {
        throw new Error('gone');
      },
      methods: METHODS,
    });
    await expect(store.search({} as never)).rejects.toThrow('gone');
    expect(facts.saved.get('k')).toEqual({});
  });
});
