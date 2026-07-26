import { vi } from 'vitest';

/**
 * Minimal IndexedDB stand-in for download tests. The backing map outlives each "connection", which is
 * what lets a test model a reload: the page goes away, the partial bytes do not.
 *
 * Only imported from tests, so it never reaches the application bundle.
 */
export interface PartialDownloadRecordDouble {
  readonly key: string;
  readonly url: string;
  readonly totalBytes: number | null;
  readonly data: Blob;
  readonly updatedAt: string;
}

type Listener = (() => void) | null;

interface FakeRequest<T> {
  result: T;
  onsuccess: Listener;
  onerror: Listener;
  onupgradeneeded: Listener;
}

interface FakeObjectStore {
  get: (key: string) => FakeRequest<PartialDownloadRecordDouble | undefined>;
  put: (record: PartialDownloadRecordDouble) => void;
  delete: (key: string) => void;
}

interface FakeTransaction {
  oncomplete: Listener;
  onerror: Listener;
  onabort: Listener;
  objectStore: (name?: string) => FakeObjectStore;
}

interface FakeDatabase {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: () => void;
  close: () => void;
  transaction: (name?: string, mode?: string) => FakeTransaction;
}

export interface IndexedDbDoubleOptions {
  /**
   * Latency applied to writes only. Set it above zero to prove that a caller waits for its partial
   * bytes to land before retrying — with a fire-and-forget flush, the retry reads an empty store and
   * silently restarts the download from zero.
   */
  readonly writeDelayMs?: number;
}

export function installIndexedDbDouble(
  store: Map<string, PartialDownloadRecordDouble>,
  options: IndexedDbDoubleOptions = {},
): void {
  const writeDelayMs = options.writeDelayMs ?? 0;

  const createTransaction = (): FakeTransaction => {
    const transaction: FakeTransaction = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: () => objectStore,
    };
    let pending = 0;

    const complete = (): void => {
      if (pending === 0) setTimeout(() => transaction.oncomplete?.(), 0);
    };
    const track = (work: () => void, delayMs = 0): void => {
      pending += 1;
      setTimeout(() => {
        work();
        pending -= 1;
        complete();
      }, delayMs);
    };

    const objectStore: FakeObjectStore = {
      get: (key) => {
        const request: FakeRequest<PartialDownloadRecordDouble | undefined> = {
          result: undefined,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        track(() => {
          request.result = store.get(key);
          request.onsuccess?.();
        });
        return request;
      },
      put: (record) => {
        track(() => store.set(record.key, record), writeDelayMs);
      },
      delete: (key) => {
        track(() => store.delete(key));
      },
    };

    setTimeout(complete, 0);
    return transaction;
  };

  const open = (): FakeRequest<FakeDatabase> => {
    const request: FakeRequest<FakeDatabase> = {
      result: {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => undefined,
        close: () => undefined,
        transaction: createTransaction,
      },
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    setTimeout(() => request.onsuccess?.(), 0);
    return request;
  };

  vi.stubGlobal('indexedDB', { open });
}

export function seedPartialDownload(
  store: Map<string, PartialDownloadRecordDouble>,
  options: {
    readonly key: string;
    readonly url: string;
    readonly bytes: readonly number[];
    readonly totalBytes: number | null;
  },
): void {
  store.set(options.key, {
    key: options.key,
    url: options.url,
    totalBytes: options.totalBytes,
    data: new Blob([new Uint8Array(options.bytes)]),
    updatedAt: '2026-07-26T00:00:00.000Z',
  });
}

/** Reads the `Range` header a mocked fetch call was made with, if any. */
export function rangeHeaderOfCall(calls: readonly unknown[][], index: number): string | undefined {
  const init = calls[index]?.[1] as RequestInit | undefined;
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.['Range'];
}
