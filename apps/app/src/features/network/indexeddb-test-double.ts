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

interface FakeCursor {
  readonly value: PartialDownloadRecordDouble;
  delete: () => void;
  continue: () => void;
}

interface FakeIndex {
  openCursor: () => FakeRequest<FakeCursor | null>;
}

interface FakeObjectStore {
  get: (key: string) => FakeRequest<PartialDownloadRecordDouble | undefined>;
  getAll: () => FakeRequest<PartialDownloadRecordDouble[]>;
  put: (record: PartialDownloadRecordDouble) => void;
  delete: (key: string) => void;
  clear: () => void;
  index: (name: string) => FakeIndex;
  openCursor: () => FakeRequest<FakeCursor | null>;
}

interface FakeTransaction {
  oncomplete: Listener;
  onerror: Listener;
  onabort: Listener;
  objectStore: (name?: string) => FakeObjectStore;
}

interface FakeDatabase {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (
    name?: string,
    config?: { readonly keyPath?: string },
  ) => FakeObjectStore | void;
  close: () => void;
  transaction: (name?: string | readonly string[], mode?: string) => FakeTransaction;
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
      getAll: () => {
        const request: FakeRequest<PartialDownloadRecordDouble[]> = {
          result: [],
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        track(() => {
          request.result = [...store.values()];
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
      clear: () => {
        track(() => store.clear());
      },
      index: () => ({
        openCursor: () => objectStore.openCursor(),
      }),
      openCursor: () => {
        const keys = [...store.keys()];
        const request: FakeRequest<FakeCursor | null> = {
          result: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        let index = 0;
        const advance = (): void => {
          track(() => {
            const key = keys[index];
            if (key === undefined) {
              request.result = null;
              request.onsuccess?.();
              return;
            }
            const value = store.get(key);
            index += 1;
            if (!value) {
              advance();
              return;
            }
            request.result = {
              value,
              delete: () => {
                store.delete(key);
              },
              continue: advance,
            };
            request.onsuccess?.();
          });
        };
        advance();
        return request;
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

export interface IndexedDbStoreDouble {
  readonly keyPath: string;
  readonly records: Map<string, Record<string, unknown>>;
}

/**
 * Multi-store IndexedDB stand-in for cache tests. Unlike the resumable-download helper above,
 * this variant honours the object-store name and keyPath so one transaction can update manifests
 * and assets independently.
 */
export function installMultiStoreIndexedDbDouble(
  stores: Map<string, IndexedDbStoreDouble>,
  options: IndexedDbDoubleOptions = {},
): void {
  const writeDelayMs = options.writeDelayMs ?? 0;
  let upgraded = false;

  const createTransaction = (): FakeTransaction => {
    let pending = 0;
    const transaction: FakeTransaction = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: (name) => objectStore(name ?? ''),
    };

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

    const objectStore = (name: string): FakeObjectStore => {
      const definition = stores.get(name);
      if (!definition) throw new Error(`Unknown IndexedDB test store: ${name}`);

      return {
        get: (key) => {
          const request: FakeRequest<PartialDownloadRecordDouble | undefined> = {
            result: undefined,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
          };
          track(() => {
            request.result = definition.records.get(key) as
              | PartialDownloadRecordDouble
              | undefined;
            request.onsuccess?.();
          });
          return request;
        },
        getAll: () => {
          const request: FakeRequest<PartialDownloadRecordDouble[]> = {
            result: [],
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
          };
          track(() => {
            request.result = [...definition.records.values()] as unknown as PartialDownloadRecordDouble[];
            request.onsuccess?.();
          });
          return request;
        },
        put: (record) => {
          const generic = record as unknown as Record<string, unknown>;
          const key = generic[definition.keyPath];
          if (typeof key !== 'string' || !key) {
            throw new Error(`Missing IndexedDB test keyPath: ${definition.keyPath}`);
          }
          track(() => definition.records.set(key, generic), writeDelayMs);
        },
        delete: (key) => {
          track(() => definition.records.delete(key));
        },
        clear: () => {
          track(() => definition.records.clear());
        },
        index: () => ({
          openCursor: () => objectStore(name).openCursor(),
        }),
        openCursor: () => {
          const keys = [...definition.records.keys()];
          const request: FakeRequest<FakeCursor | null> = {
            result: null,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
          };
          let index = 0;
          const advance = (): void => {
            track(() => {
              const key = keys[index];
              if (key === undefined) {
                request.result = null;
                request.onsuccess?.();
                return;
              }
              const value = definition.records.get(key);
              index += 1;
              if (!value) {
                advance();
                return;
              }
              request.result = {
                value: value as unknown as PartialDownloadRecordDouble,
                delete: () => {
                  definition.records.delete(key);
                },
                continue: advance,
              };
              request.onsuccess?.();
            });
          };
          advance();
          return request;
        },
      };
    };

    setTimeout(complete, 0);
    return transaction;
  };

  const database: FakeDatabase = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name = '', config) => {
      if (!name) throw new Error('IndexedDB test store name is required.');
      if (!stores.has(name)) {
        stores.set(name, {
          keyPath: config?.keyPath ?? 'id',
          records: new Map(),
        });
      }
    },
    close: () => undefined,
    transaction: createTransaction,
  };

  const open = (): FakeRequest<FakeDatabase> => {
    const request: FakeRequest<FakeDatabase> = {
      result: database,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    setTimeout(() => {
      if (!upgraded) {
        upgraded = true;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    }, 0);
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
  // biome-ignore lint/complexity/useLiteralKeys: HTTP header names are runtime keys.
  return headers?.['Range'];
}
