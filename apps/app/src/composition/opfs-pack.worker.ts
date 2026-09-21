/// <reference lib="webworker" />

import { SqliteMedicalStore } from '@localmed/storage-sqlite';

import type {
  OpfsPackWorkerRequest,
  OpfsPackWorkerResponse,
} from '@/composition/opfs-pack-protocol';

let store: SqliteMedicalStore | undefined;
let downloadApproval: { id: number; resolve: () => void } | undefined;

self.onmessage = async (event: MessageEvent<OpfsPackWorkerRequest>): Promise<void> => {
  const message = event.data;
  try {
    if (message.type === 'approve-download') {
      if (downloadApproval?.id !== message.id) throw new Error('Unexpected download approval.');
      downloadApproval.resolve();
      downloadApproval = undefined;
      return;
    }
    if (message.type === 'open') {
      if (store) throw new Error('OPFS pack worker is already open.');
      // A pool owns exclusive filesystem handles until its worker terminates. Keep the matching
      // browser lock for that lifetime so a reload waits for the old worker's teardown.
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request(`minimed-opfs:${message.poolName}`, () => new Promise<void>(() => resolve()))
          .catch(reject);
      });
      const next = await SqliteMedicalStore.createFromOpfsUrl(message.url, message.databaseName, {
        fetchTimeoutMs: message.fetchTimeoutMs,
        poolName: message.poolName,
        ...(message.waitForDownloadApproval
          ? {
              beforeImport: () =>
                new Promise<void>((resolve) => {
                  downloadApproval = { id: message.id, resolve };
                  self.postMessage({
                    id: message.id,
                    event: 'download-required',
                  } satisfies OpfsPackWorkerResponse);
                }),
              onImportProgress: (loaded: number, total: number) =>
                self.postMessage({
                  id: message.id,
                  event: 'download-progress',
                  loaded,
                  total,
                } satisfies OpfsPackWorkerResponse),
            }
          : {}),
      });
      const health = await next.initialize();
      store = next;
      self.postMessage({ id: message.id, result: health } satisfies OpfsPackWorkerResponse);
      return;
    }

    if (!store) throw new Error('OPFS pack store is not open.');

    if (message.method === 'close') {
      await store.close();
      store = undefined;
      self.postMessage({ id: message.id, result: undefined } satisfies OpfsPackWorkerResponse);
      return;
    }

    const method = store[message.method].bind(store) as (
      ...args: readonly unknown[]
    ) => Promise<unknown>;
    const result = await method(...message.args);
    self.postMessage({ id: message.id, result } satisfies OpfsPackWorkerResponse);
  } catch (cause) {
    self.postMessage({
      id: message.id,
      error: cause instanceof Error ? cause.message : 'OPFS pack worker failed.',
    } satisfies OpfsPackWorkerResponse);
  }
};
