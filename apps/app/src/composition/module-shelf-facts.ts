import type { StorageHealth } from '@localmed/storage';

import { recordInstallPhase } from '@/features/modules/install-timing';

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
const STORE = 'fact-pages';
const LEGACY_STORE = 'facts';
const PAGE_ROWS = 128;
const SAVE_DELAY_MS = 800;

type FactsPage = {
  readonly app: string;
  readonly file: string;
  readonly part: number;
} & (
  | { readonly facts: ShelfFacts }
  | { readonly listing: string; readonly rows: readonly unknown[] }
);

function filePages(app: string, file: string): IDBKeyRange {
  return IDBKeyRange.bound([app, file, 0], [app, file, Number.MAX_SAFE_INTEGER]);
}

function* pages(app: string, file: string, facts: ShelfFacts): Generator<FactsPage> {
  const entries = Object.entries(facts.listings ?? {});
  const size = entries.reduce(
    (total, [, value]) => total + (Array.isArray(value) ? value.length : 0),
    0,
  );
  if (size <= PAGE_ROWS) {
    yield { app, file, part: 0, facts };
    return;
  }

  // Preserve empty listings in the header. Each subsequent IDB event clones one bounded page.
  const listings: Record<string, unknown> = Object.fromEntries(
    entries.map(([name, value]) => [name, Array.isArray(value) ? [] : value]),
  );
  yield { app, file, part: 0, facts: { ...facts, listings } };
  let part = 1;
  for (const [listing, value] of entries) {
    if (!Array.isArray(value)) continue;
    for (let offset = 0; offset < value.length; offset += PAGE_ROWS) {
      yield { app, file, part: part++, listing, rows: value.slice(offset, offset + PAGE_ROWS) };
    }
  }
}

function openFactsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 3);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      // The old rows are rebuildable facts. Reading them would clone all the listings at once.
      if (database.objectStoreNames.contains(LEGACY_STORE))
        database.deleteObjectStore(LEGACY_STORE);
      database.createObjectStore(STORE, { keyPath: ['app', 'file', 'part'] });
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
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      let facts: ShelfFacts | undefined;
      let pageCount = 0;
      const request = database
        .transaction(STORE, 'readonly')
        .objectStore(STORE)
        .openCursor(filePages(appVersion, file));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          if (pageCount > 1 || performance.now() - startedAt >= 250) {
            recordInstallPhase('module-facts-read', startedAt, { pages: pageCount });
          }
          resolve(facts);
          return;
        }
        const page = cursor.value as FactsPage;
        if ('facts' in page) facts = page.facts;
        else {
          const listing = facts?.listings?.[page.listing];
          if (Array.isArray(listing)) listing.push(...page.rows);
        }
        pageCount += 1;
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Module facts could not be read.'));
    });
  };

  const pruneOldBuilds = async (): Promise<void> => {
    const database = await connect();
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    // A key cursor never deserializes old document listings.
    const request = store.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const [version] = cursor.key as [string, string, number];
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
    const writeFile = (): void => {
      const next = pending.next();
      if (next.done) return;
      const [file, facts] = next.value;
      const fileRows = pages(appVersion, file, facts);
      const writePage = (): void => {
        const page = fileRows.next();
        if (page.done) writeFile();
        // A put clones synchronously. Let its callback schedule the next bounded clone.
        else store.put(page.value).onsuccess = writePage;
      };
      // Remove trailing pages if a listing shrank, in the same transaction as its replacement.
      store.delete(filePages(appVersion, file)).onsuccess = writePage;
    };
    writeFile();
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
