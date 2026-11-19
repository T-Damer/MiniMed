import type { StorageHealth } from '@localmed/storage';

/**
 * What a module file answers the same way every time it is opened: its health and its whole-pack
 * listings. A module file never changes (its name carries the version and the checksum), yet every
 * start asked each of ~800 installed modules for them again — 5.8 s of the start on a phone. They
 * are kept here per file and per app build; a new build asks the files again once.
 */
export interface ShelfFacts {
  health?: StorageHealth;
  listings?: Record<string, unknown>;
}

export interface ShelfFactsStore {
  /** Only the requested file's facts for this app build. */
  load(file: string): Promise<ShelfFacts | undefined>;
  /** Keeps `facts` of `file`; written a little later, many files in one transaction. */
  save(file: string, facts: ShelfFacts): void;
}

const DATABASE = 'minimed-module-facts-v1';
const STORE = 'facts';
const BUILD_FILE_INDEX = 'build-file';
const SAVE_DELAY_MS = 800;

interface FactsRow extends ShelfFacts {
  readonly file: string;
  readonly app: string;
}

function openFactsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains(STORE)
        ? request.transaction?.objectStore(STORE)
        : undefined;
      // Version 1 already records both key fields. Build the index without reading the listings
      // into the page so existing facts for this build can still be used.
      (store ?? request.result.createObjectStore(STORE, { keyPath: 'file' })).createIndex(
        BUILD_FILE_INDEX,
        ['app', 'file'],
      );
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Another tab is using the previous module facts cache.'));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Module facts are unavailable.'));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Module facts failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Module facts aborted.'));
  });
}

/** Facts in IndexedDB, valid for `appVersion` only. A storage failure means «nothing kept». */
export function createIndexedDbShelfFacts(appVersion: string): ShelfFactsStore {
  let connection: Promise<IDBDatabase> | undefined;
  let readFailureReported = false;
  let pruneScheduled = false;
  const unsaved = new Map<string, ShelfFacts>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = (): Promise<IDBDatabase> => {
    connection ??= openFactsDatabase().then((database) => {
      database.onversionchange = () => {
        database.close();
        connection = undefined;
      };
      return database;
    });
    return connection;
  };

  const read = async (file: string): Promise<ShelfFacts | undefined> => {
    const database = await connect();
    return new Promise((resolve, reject) => {
      const request = database
        .transaction(STORE, 'readonly')
        .objectStore(STORE)
        .index(BUILD_FILE_INDEX)
        .get([appVersion, file]);
      request.onsuccess = () => resolve(request.result as FactsRow | undefined);
      request.onerror = () => reject(request.error ?? new Error('Module facts could not be read.'));
    });
  };

  const pruneOldBuilds = async (): Promise<void> => {
    const database = await connect();
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    // A key cursor never deserializes old document listings.
    const request = store.index(BUILD_FILE_INDEX).openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const [version] = cursor.key as [string, string];
      if (version !== appVersion) store.delete(cursor.primaryKey);
      cursor.continue();
    };
    await done(transaction);
  };

  const flush = async (): Promise<void> => {
    timer = undefined;
    const rows = [...unsaved];
    unsaved.clear();
    if (rows.length === 0) return;
    const database = await connect();
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const pending = rows.values();
    const writeNext = (): void => {
      const next = pending.next();
      if (next.done) return;
      const [file, facts] = next.value;
      const row: FactsRow = { ...facts, file, app: appVersion };
      // A put clones its value synchronously. Wait for its callback before cloning another.
      store.put(row).onsuccess = writeNext;
    };
    writeNext();
    await done(transaction);
    if (!pruneScheduled && typeof requestIdleCallback === 'function') {
      pruneScheduled = true;
      requestIdleCallback(() => {
        void pruneOldBuilds().catch((cause: unknown) => {
          console.warn('Old module facts were not removed.', cause);
        });
      });
    }
  };

  return {
    async load(file) {
      const waiting = unsaved.get(file);
      if (waiting) return waiting;
      return read(file).catch((cause: unknown) => {
        if (!readFailureReported) {
          readFailureReported = true;
          console.warn('Module facts were not read; the module files are asked instead.', cause);
        }
        return undefined;
      });
    },
    save(file, facts) {
      unsaved.set(file, facts);
      timer ??= setTimeout(() => {
        flush().catch((cause: unknown) => {
          console.warn('Module facts were not kept.', cause);
        });
      }, SAVE_DELAY_MS);
    },
  };
}

let shared: { readonly version: string; readonly store: ShelfFactsStore } | undefined;

/** Shelf shards and standalone OPFS pools read and write the same records in this page. */
export function getBrowserModuleFacts(appVersion: string): ShelfFactsStore | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  if (shared?.version !== appVersion) {
    shared = { version: appVersion, store: createIndexedDbShelfFacts(appVersion) };
  }
  return shared.store;
}
