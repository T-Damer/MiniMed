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
  /** Every kept record of this app build, read once. */
  load(): Promise<ReadonlyMap<string, ShelfFacts>>;
  /** Keeps `facts` of `file`; written a little later, many files in one transaction. */
  save(file: string, facts: ShelfFacts): void;
}

const DATABASE = 'minimed-module-facts-v1';
const STORE = 'facts';
const SAVE_DELAY_MS = 800;

interface FactsRow extends ShelfFacts {
  readonly file: string;
  readonly app: string;
}

function openFactsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'file' });
    };
    request.onsuccess = () => resolve(request.result);
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
  let loaded: Promise<ReadonlyMap<string, ShelfFacts>> | undefined;
  const unsaved = new Map<string, ShelfFacts>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const read = async (): Promise<ReadonlyMap<string, ShelfFacts>> => {
    const database = await openFactsDatabase();
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const facts = new Map<string, ShelfFacts>();
      // IndexedDB deserializes results on this thread. A cursor returns one module per task.
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const row = cursor.value as FactsRow;
        // Kept by another build: that build may have read the file differently.
        if (row.app !== appVersion) cursor.delete();
        else {
          facts.set(row.file, {
            ...(row.health ? { health: row.health } : {}),
            ...(row.listings ? { listings: row.listings } : {}),
          });
        }
        cursor.continue();
      };
      await done(transaction);
      return facts;
    } finally {
      database.close();
    }
  };

  const flush = async (): Promise<void> => {
    timer = undefined;
    const rows = [...unsaved];
    unsaved.clear();
    if (rows.length === 0) return;
    const database = await openFactsDatabase();
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const pending = rows.values();
      const writeNext = (): void => {
        const next = pending.next();
        if (next.done) return;
        const [file, facts] = next.value;
        const row: FactsRow = { file, app: appVersion, ...facts };
        // A put clones its value synchronously. Wait for its callback before cloning another.
        store.put(row).onsuccess = writeNext;
      };
      writeNext();
      await done(transaction);
    } finally {
      database.close();
    }
  };

  return {
    load() {
      loaded ??= read().catch((cause: unknown) => {
        console.warn('Module facts were not read; the module files are asked instead.', cause);
        return new Map<string, ShelfFacts>();
      });
      return loaded;
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
