import type { MedicalStore } from '@localmed/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetKeptListingsForTests, withKeptListings } from '@/composition/store-listing-memo';

function fakeStore() {
  return {
    initialize: vi.fn(async () => ({ schemaVersion: 2 })),
    listSearchDocuments: vi.fn(async () => [{ id: 'a' }]),
    listAliases: vi.fn(async () => []),
    getDocument: vi.fn(async (id: string) => ({ id })),
    close: vi.fn(async () => undefined),
  } as unknown as MedicalStore & {
    listSearchDocuments: ReturnType<typeof vi.fn>;
    getDocument: ReturnType<typeof vi.fn>;
  };
}

describe('withKeptListings', () => {
  beforeEach(() => resetKeptListingsForTests());

  it('asks a listing once per key, across stores opened on the same database', async () => {
    const first = fakeStore();
    const second = fakeStore();
    const a = withKeptListings(first, 'core:1');
    const b = withKeptListings(second, 'core:1');
    expect(await a.listSearchDocuments?.()).toEqual([{ id: 'a' }]);
    expect(await b.listSearchDocuments?.()).toEqual([{ id: 'a' }]);
    expect(first.listSearchDocuments).toHaveBeenCalledTimes(1);
    expect(second.listSearchDocuments).not.toHaveBeenCalled();
  });

  it('keeps nothing across keys and passes other calls through', async () => {
    const first = fakeStore();
    const second = fakeStore();
    await withKeptListings(first, 'core:1').listSearchDocuments?.();
    await withKeptListings(second, 'core:2').listSearchDocuments?.();
    expect(second.listSearchDocuments).toHaveBeenCalledTimes(1);
    await withKeptListings(first, 'core:1').getDocument('x');
    await withKeptListings(first, 'core:1').getDocument('x');
    expect(first.getDocument).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed read and the listings of a store given new content', async () => {
    const store = fakeStore();
    store.listSearchDocuments.mockRejectedValueOnce(new Error('bridge'));
    const kept = withKeptListings(store, 'core:1');
    await expect(kept.listSearchDocuments?.()).rejects.toThrow('bridge');
    await Promise.resolve();
    expect(await kept.listSearchDocuments?.()).toEqual([{ id: 'a' }]);
    await kept.initialize({} as never);
    await kept.listSearchDocuments?.();
    expect(store.listSearchDocuments).toHaveBeenCalledTimes(3);
  });
});
