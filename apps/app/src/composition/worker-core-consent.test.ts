import type { StorageHealth } from '@localmed/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpfsPackWorkerRequest, OpfsPackWorkerResponse } from './opfs-pack-protocol';
import { WorkerOpfsMedicalStore } from './worker-opfs-medical-store';

const health: StorageHealth = {
  schemaVersion: 2,
  sqliteVersion: 'test',
  fts5Available: true,
  contentPackIds: ['core'],
  documentCount: 1,
  backend: 'sqlite-wasm',
  persistent: true,
  installation: 'reused',
  sizeBytes: 4096,
};
const options = {
  url: 'https://example.invalid/core.db',
  databaseName: 'core.db',
  fetchTimeoutMs: 1000,
  poolName: 'consent-test',
};
class FakeWorker {
  onmessage: ((event: MessageEvent<OpfsPackWorkerResponse>) => void) | undefined;
  onerror: (() => void) | undefined;
  terminate = vi.fn();
  postMessage = vi.fn((message: OpfsPackWorkerRequest) => {
    if (message.type === 'call' && message.method === 'close')
      this.emit({ id: message.id, result: undefined });
  });
  emit(data: OpfsPackWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<OpfsPackWorkerResponse>);
  }
}
function mockWorker(): FakeWorker[] {
  const instances: FakeWorker[] = [];
  vi.stubGlobal(
    'Worker',
    class extends FakeWorker {
      constructor() {
        super();
        instances.push(this);
      }
    },
  );
  return instances;
}
function first(instances: FakeWorker[]): FakeWorker {
  const worker = instances[0];
  if (!worker) throw new Error('Worker was not created.');
  return worker;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('existing OPFS owner core download consent', () => {
  it('pauses the open deadline while the user decides, then resumes the same worker', async () => {
    vi.useFakeTimers();
    const instances = mockWorker();
    let approve = () => {};
    const requestDownload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        }),
    );
    const onProgress = vi.fn();
    const opened = WorkerOpfsMedicalStore.open(options, { requestDownload, onProgress });
    const worker = first(instances);
    expect(worker.postMessage).toHaveBeenCalledWith({
      ...options,
      id: 1,
      type: 'open',
      waitForDownloadApproval: true,
    });
    worker.emit({ id: 1, event: 'download-required' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(requestDownload).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    approve();
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, type: 'approve-download' });
    worker.emit({ id: 1, event: 'download-progress', loaded: 2048, total: 4096 });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 2048, total: 4096 });
    worker.emit({ id: 1, result: health });
    const store = await opened;
    expect(instances).toHaveLength(1);
    await store.close();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('opens an installed file without asking for another download', async () => {
    const instances = mockWorker();
    const requestDownload = vi.fn(async () => {});
    const opened = WorkerOpfsMedicalStore.open(options, { requestDownload, onProgress: vi.fn() });
    first(instances).emit({ id: 1, result: health });
    const store = await opened;
    expect(requestDownload).not.toHaveBeenCalled();
    await store.close();
  });
  it('rejects declined consent and releases the owner without approving a transfer', async () => {
    const instances = mockWorker();
    const opened = WorkerOpfsMedicalStore.open(options, {
      requestDownload: async () => {
        throw new Error('Declined');
      },
      onProgress: vi.fn(),
    });
    const failure = expect(opened).rejects.toThrow('Declined');
    const worker = first(instances);
    worker.emit({ id: 1, event: 'download-required' });
    await failure;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });
});
