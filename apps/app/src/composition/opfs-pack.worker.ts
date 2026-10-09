/// <reference lib="webworker" />

import { type OpfsPackSource, SqliteMedicalStore } from '@localmed/storage-sqlite';

import type {
  OpfsPackWorkerOpenOptions,
  OpfsPackWorkerRequest,
  OpfsPackWorkerResponse,
} from '@/composition/opfs-pack-protocol';
import {
  createDecodedIndexReader,
  type DecodedIndexStats,
} from '@/features/modules/encoded-index-reader';
import { type EpochInstallPhase, epochNow } from '@/features/modules/install-timing';

let store: SqliteMedicalStore | undefined;
let downloadApproval: { id: number; resolve: () => void } | undefined;
/** Bytes streamed into OPFS so far; reported again when installation starts. */
let importedBytes = 0;

/** Where an import spent its time, on this worker's clock. */
interface ImportTimings {
  firstReadAt?: number;
  /** Total time spent producing bytes (decode, hash); the rest of the import is writing. */
  readMs: number;
  stats: DecodedIndexStats;
}

function opfsSource(options: OpfsPackWorkerOpenOptions, timings: ImportTimings): OpfsPackSource {
  if ('url' in options) return { kind: 'url', url: options.url };
  if ('installed' in options)
    return { kind: 'installed', byteLength: options.installed.byteLength };
  const { encoded } = options;
  return {
    kind: 'stream',
    byteLength: encoded.decodedSizeBytes,
    // Decoded straight into the pool one frame at a time; the checksum is verified before the
    // last chunk is reported, so a mismatch leaves no file behind.
    open: () => {
      const read = createDecodedIndexReader(encoded, { stats: timings.stats });
      return async () => {
        timings.firstReadAt ??= epochNow();
        const startedAt = performance.now();
        try {
          return await read();
        } finally {
          timings.readMs += performance.now() - startedAt;
        }
      };
    },
  };
}

function importPhases(
  timings: ImportTimings,
  openedAt: number,
  lockAcquiredAt: number,
  importedAt: number | undefined,
  readyAt: number,
): readonly EpochInstallPhase[] {
  const phases: EpochInstallPhase[] = [
    { phase: 'worker-open', startEpochMs: openedAt, endEpochMs: readyAt },
  ];
  if (timings.firstReadAt === undefined || importedAt === undefined) return phases;
  const importMs = importedAt - timings.firstReadAt;
  // decode, hash and write alternate slice by slice, so each is reported as its summed duration
  // laid out from the start of the import.
  const writeMs = Math.max(0, importMs - timings.readMs);
  const aggregate = (phase: string, ms: number): EpochInstallPhase => ({
    phase,
    startEpochMs: timings.firstReadAt as number,
    endEpochMs: (timings.firstReadAt as number) + ms,
  });
  phases.push(
    { phase: 'pool-open', startEpochMs: lockAcquiredAt, endEpochMs: timings.firstReadAt },
    { phase: 'import', startEpochMs: timings.firstReadAt, endEpochMs: importedAt },
    aggregate('import-decode', timings.stats.decodeMs),
    aggregate('import-hash', timings.stats.hashMs),
    aggregate('import-write', writeMs),
    { phase: 'db-open', startEpochMs: importedAt, endEpochMs: readyAt },
  );
  return phases;
}

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
      const openedAt = epochNow();
      if (store) throw new Error('OPFS pack worker is already open.');
      // A pool owns exclusive filesystem handles until its worker terminates. Keep the matching
      // browser lock for that lifetime so a reload waits for the old worker's teardown.
      // Another tab can hold it indefinitely, so report the wait instead of timing out.
      const lockName = `minimed-opfs:${message.poolName}`;
      const holdLock = (lock: Lock | null, resolve: (held: boolean) => void) =>
        new Promise<void>(() => resolve(lock !== null));
      const acquiredImmediately = await new Promise<boolean>((resolve, reject) => {
        void navigator.locks
          .request(lockName, { ifAvailable: true }, (lock) => {
            if (lock === null) {
              resolve(false);
              return undefined;
            }
            return holdLock(lock, resolve);
          })
          .catch(reject);
      });
      if (!acquiredImmediately) {
        self.postMessage({ id: message.id, status: 'lock-wait' } satisfies OpfsPackWorkerResponse);
        await new Promise<boolean>((resolve, reject) => {
          void navigator.locks.request(lockName, (lock) => holdLock(lock, resolve)).catch(reject);
        });
      }
      self.postMessage({
        id: message.id,
        status: 'lock-acquired',
      } satisfies OpfsPackWorkerResponse);
      importedBytes = 0;
      const lockAcquiredAt = epochNow();
      const timings: ImportTimings = { readMs: 0, stats: { decodeMs: 0, hashMs: 0 } };
      let importedAt: number | undefined;
      const next = await SqliteMedicalStore.createFromOpfsSource(
        opfsSource(message, timings),
        message.databaseName,
        {
          fetchTimeoutMs: message.fetchTimeoutMs,
          poolName: message.poolName,
          onImportInstalling: () => {
            importedAt = epochNow();
            if (!message.waitForDownloadApproval) return;
            self.postMessage({
              id: message.id,
              event: 'download-progress',
              loaded: importedBytes,
              total: importedBytes,
              phase: 'installing',
            } satisfies OpfsPackWorkerResponse);
          },
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
                onImportProgress: (loaded: number, total: number) => {
                  importedBytes = loaded;
                  self.postMessage({
                    id: message.id,
                    event: 'download-progress',
                    loaded,
                    total,
                  } satisfies OpfsPackWorkerResponse);
                },
              }
            : {}),
        },
      );
      const health = await next.initialize();
      store = next;
      self.postMessage({
        id: message.id,
        event: 'timing',
        phases: importPhases(timings, openedAt, lockAcquiredAt, importedAt, epochNow()),
      } satisfies OpfsPackWorkerResponse);
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
