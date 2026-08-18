import type { StorageHealth } from '@localmed/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkerOpfsMedicalStore } from '@/composition/worker-opfs-medical-store';

const HEALTH: StorageHealth = {
  schemaVersion: 1,
  sqliteVersion: 'test',
  fts5Available: true,
  contentPackIds: ['pack'],
  documentCount: 1,
  backend: 'sqlite-wasm',
  persistent: true,
  installation: 'copied',
  sizeBytes: 421_000_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkerOpfsMedicalStore', () => {
  it('opens the pack in a dedicated worker with an isolated SAH pool name', async () => {
    const postMessage = vi.fn();
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      vi.fn(function FakeWorker(this: Record<string, unknown>) {
        this['postMessage'] = postMessage;
        this['terminate'] = terminate;
        this['onmessage'] = undefined;
        this['onerror'] = undefined;
      }),
    );

    const openPromise = WorkerOpfsMedicalStore.open({
      url: 'https://example.test/content/medications.db',
      databaseName: 'medications.db',
      fetchTimeoutMs: 180_000,
      poolName: 'minimed-sah-pack',
    });

    expect(postMessage).toHaveBeenCalledWith({
      id: 1,
      type: 'open',
      url: 'https://example.test/content/medications.db',
      databaseName: 'medications.db',
      fetchTimeoutMs: 180_000,
      poolName: 'minimed-sah-pack',
    });

    const worker = vi.mocked(Worker).mock.instances[0] as unknown as {
      onmessage?: (event: MessageEvent) => void;
    };
    worker.onmessage?.({ data: { id: 1, result: HEALTH } } as MessageEvent);

    const store = await openPromise;
    const documents = [{ id: 'doc-1' }];
    const listPromise = store.listDocuments();
    expect(postMessage).toHaveBeenCalledWith({
      id: 2,
      type: 'call',
      method: 'listDocuments',
      args: [],
    });
    worker.onmessage?.({ data: { id: 2, result: documents } } as MessageEvent);
    await expect(listPromise).resolves.toEqual(documents);

    const closePromise = store.close();
    expect(postMessage).toHaveBeenCalledWith({
      id: 3,
      type: 'call',
      method: 'close',
      args: [],
    });
    worker.onmessage?.({ data: { id: 3, result: undefined } } as MessageEvent);
    await closePromise;
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('rejects pending calls when the worker fails', async () => {
    const postMessage = vi.fn();
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      vi.fn(function FakeWorker(this: Record<string, unknown>) {
        this['postMessage'] = postMessage;
        this['terminate'] = terminate;
        this['onmessage'] = undefined;
        this['onerror'] = undefined;
      }),
    );

    const openPromise = WorkerOpfsMedicalStore.open({
      url: 'https://example.test/content/medications.db',
      databaseName: 'medications.db',
      fetchTimeoutMs: 180_000,
      poolName: 'minimed-sah-pack',
    });
    const worker = vi.mocked(Worker).mock.instances[0] as unknown as {
      onmessage?: (event: MessageEvent) => void;
      onerror?: () => void;
    };
    worker.onmessage?.({ data: { id: 1, result: HEALTH } } as MessageEvent);
    const store = await openPromise;

    const listPromise = store.listDocuments();
    worker.onerror?.();
    await expect(listPromise).rejects.toThrow('OPFS pack worker failed.');
    expect(terminate).toHaveBeenCalledOnce();

    await store.close();
    expect(terminate).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('terminates the worker when open fails', async () => {
    const postMessage = vi.fn();
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      vi.fn(function FakeWorker(this: Record<string, unknown>) {
        this['postMessage'] = postMessage;
        this['terminate'] = terminate;
        this['onmessage'] = undefined;
        this['onerror'] = undefined;
      }),
    );

    const openPromise = WorkerOpfsMedicalStore.open({
      url: 'https://example.test/content/medications.db',
      databaseName: 'medications.db',
      fetchTimeoutMs: 180_000,
      poolName: 'minimed-sah-pack',
    });
    const worker = vi.mocked(Worker).mock.instances[0] as unknown as {
      onmessage?: (event: MessageEvent) => void;
    };
    worker.onmessage?.({
      data: { id: 1, error: 'Missing required OPFS APIs.' },
    } as MessageEvent);

    await expect(openPromise).rejects.toThrow('Missing required OPFS APIs.');
    expect(terminate).toHaveBeenCalledOnce();
  });
});
