/// <reference lib="webworker" />

import { SqliteMedicalStore } from '@localmed/storage-sqlite';

import type {
  OpfsPackWorkerRequest,
  OpfsPackWorkerResponse,
} from '@/composition/opfs-pack-protocol';

let store: SqliteMedicalStore | undefined;

self.onmessage = async (event: MessageEvent<OpfsPackWorkerRequest>): Promise<void> => {
  const message = event.data;
  try {
    if (message.type === 'open') {
      store = await SqliteMedicalStore.createFromOpfsUrl(message.url, message.databaseName, {
        fetchTimeoutMs: message.fetchTimeoutMs,
        poolName: message.poolName,
      });
      const health = await store.initialize();
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
