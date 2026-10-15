import type {
  OpfsPackWorkerCallArgs,
  OpfsPackWorkerMethod,
} from '@/composition/opfs-pack-protocol';

/**
 * Messages between the app and the module shelf worker: one worker, one OPFS pool, one SQLite
 * connection per installed module file. The shelf exists so that the memory of the installed
 * library does not grow with the size of its modules (see `module-shelf.ts`).
 */

/** Every store method a shelf database serves; `close` is the shelf's own message. */
export type ShelfCallMethod = Exclude<OpfsPackWorkerMethod, 'close'>;
export type ShelfCallArgs = OpfsPackWorkerCallArgs;

export type ShelfRequest =
  | { readonly id: number; readonly type: 'init'; readonly poolName: string }
  | {
      readonly id: number;
      readonly type: 'open';
      /** The file's name in the pool without the leading slash; also the key of the connection. */
      readonly file: string;
      readonly byteLength: number;
      /** The database image to write when the pool does not hold the file yet. */
      readonly bytes?: Uint8Array;
      /** Page cache of this connection in KiB (see `shelfCacheKiB`). */
      readonly cacheSizeKiB: number;
    }
  | {
      readonly id: number;
      readonly type: 'put';
      readonly file: string;
      readonly byteLength: number;
      readonly bytes: Uint8Array;
    }
  | { readonly id: number; readonly type: 'read'; readonly file: string }
  | { readonly id: number; readonly type: 'stats' }
  /**
   * Calls made in the same turn of the event loop, answered by one message: a search asks every
   * mounted module at once, and one message per module cost more than the small queries did.
   */
  | { readonly id: number; readonly type: 'batch'; readonly calls: readonly ShelfCall[] }
  | { readonly id: number; readonly type: 'close'; readonly file: string }
  | {
      readonly id: number;
      readonly type: 'sweep';
      /** Files whose name belongs to one of these version keys stay (see `shelfFileBelongsTo`). */
      readonly referencedVersionKeys: readonly string[];
    };

export interface ShelfCall {
  readonly file: string;
  readonly method: ShelfCallMethod;
  readonly args: readonly unknown[];
}

/** One call's outcome inside a batch: its value, or the message of the error it threw. */
export type ShelfCallOutcome = { readonly value: unknown } | { readonly error: string };

/** What the shelf worker holds: open connections and the size its sqlite wasm heap has grown to. */
export interface ShelfStats {
  readonly openFiles: number;
  readonly heapBytes: number;
}

export type ShelfLockStatus = 'lock-wait' | 'lock-acquired';

export type ShelfResponse =
  | { readonly id: number; readonly result: unknown }
  | { readonly id: number; readonly error: string }
  | { readonly id: number; readonly status: ShelfLockStatus };
