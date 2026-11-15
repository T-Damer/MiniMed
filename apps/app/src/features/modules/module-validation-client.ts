import type { DefinitionReferenceRequest } from '@localmed/contracts';
import type { IntegrityScan } from '@localmed/storage-sqlite';

import type {
  ModuleInspection,
  ModuleInspectionRequest,
  ModuleInspectionResponse,
} from '@/features/modules/module-validation-protocol';

/** The worker and its SQLite heap are let go this long after the last check. */
const IDLE_MS = 30_000;

interface Pending {
  readonly resolve: (result: ModuleInspection) => void;
  readonly reject: (error: Error) => void;
}

let worker: Worker | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

export function moduleValidationWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

function stop(): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  worker?.terminate();
  worker = undefined;
}

function fail(error: Error): void {
  stop();
  for (const call of pending.values()) call.reject(error);
  pending.clear();
}

function start(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./module-validation.worker.ts', import.meta.url), {
    type: 'module',
  });
  created.onmessage = (event: MessageEvent<ModuleInspectionResponse>) => {
    const response = event.data;
    const call = pending.get(response.id);
    if (!call) return;
    pending.delete(response.id);
    if (pending.size === 0) idleTimer = setTimeout(stop, IDLE_MS);
    if ('error' in response) call.reject(new Error(response.error));
    else call.resolve(response.result);
  };
  created.onerror = (event) =>
    fail(new Error(event.message || 'Не удалось проверить загруженную базу.'));
  worker = created;
  return created;
}

/**
 * Checks a module index off the main thread. The bytes are copied to the worker, not moved: the
 * installer still stores them after a successful check.
 */
export function inspectModuleIndexInWorker(
  bytes: Uint8Array,
  scan: IntegrityScan,
  reference?: DefinitionReferenceRequest,
): Promise<ModuleInspection> {
  return new Promise((resolve, reject) => {
    const target = start();
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = undefined;
    nextId += 1;
    pending.set(nextId, { resolve, reject });
    const request: ModuleInspectionRequest = {
      id: nextId,
      bytes,
      scan,
      ...(reference ? { reference } : {}),
    };
    target.postMessage(request);
  });
}
