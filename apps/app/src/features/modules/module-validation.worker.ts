/// <reference lib="webworker" />

import { SqliteMedicalStore } from '@localmed/storage-sqlite';

import { inspectModuleStore } from '@/features/modules/module-inspection';
import type {
  ModuleInspectionRequest,
  ModuleInspectionResponse,
} from '@/features/modules/module-validation-protocol';

/**
 * Opens a downloaded module index in this worker's own SQLite heap, runs the integrity checks and
 * closes it. On the page the same checks held the main thread for every installed module.
 */
const reply = (response: ModuleInspectionResponse): void => self.postMessage(response);

/** One database image in the heap at a time. */
let queue: Promise<void> = Promise.resolve();

async function inspect(request: ModuleInspectionRequest): Promise<void> {
  let store: SqliteMedicalStore | undefined;
  try {
    store = await SqliteMedicalStore.createFromBytes(request.bytes);
    const result = await inspectModuleStore(store, request.scan, request.reference);
    reply({ id: request.id, result });
  } catch (cause) {
    reply({
      id: request.id,
      error: cause instanceof Error ? cause.message : 'Не удалось проверить загруженную базу.',
    });
  } finally {
    await store?.close().catch(() => undefined);
  }
}

self.onmessage = (event: MessageEvent<ModuleInspectionRequest>): void => {
  queue = queue.then(() => inspect(event.data));
};
