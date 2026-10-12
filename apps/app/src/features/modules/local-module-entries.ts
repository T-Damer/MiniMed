import {
  type ContentModuleCatalog,
  type ContentModuleCatalogEntry,
  ContentModuleCatalogEntrySchema,
} from '@localmed/contracts';

/**
 * Catalog entries of modules installed from a file (`.minimed-module.zip`). No remote catalog
 * lists them, so their descriptors live here, in a database of their own (a descriptor with a
 * document table can run to megabytes), and are merged into whatever catalog the runtime holds.
 *
 * Rows are keyed `moduleId@version`: a rolled-back version keeps its descriptor. The runtime shows
 * only the row that matches the registry's active version and prunes the rest.
 */
export const LOCAL_MODULE_DATABASE = 'minimed-local-modules';
export const LOCAL_MODULE_STORE = 'entries';

interface StoredLocalModuleEntry {
  readonly key: string;
  readonly moduleId: string;
  readonly version: string;
  readonly importedAt: string;
  readonly entry: unknown;
}

const entries = new Map<string, ContentModuleCatalogEntry>();
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function entryKey(moduleId: string, version: string): string {
  return `${moduleId}@${version}`;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Ошибка хранилища модулей из файлов.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(LOCAL_MODULE_DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(LOCAL_MODULE_STORE, { keyPath: 'key' });
  };
  return requestResult(request);
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(LOCAL_MODULE_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Не удалось записать модуль из файла.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Запись модуля из файла прервана.'));
    });
    const result = await action(transaction.objectStore(LOCAL_MODULE_STORE));
    await done;
    return result;
  } finally {
    database.close();
  }
}

function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Descriptors loaded so far; empty until {@link loadLocalModuleEntries} resolves. */
export function localModuleEntries(): readonly ContentModuleCatalogEntry[] {
  return [...entries.values()];
}

export function subscribeLocalModuleEntries(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the stored descriptors once; later calls share the result. Never rejects. */
export function loadLocalModuleEntries(): Promise<void> {
  if (!storageAvailable()) return Promise.resolve();
  loading ??= withStore('readonly', (store) =>
    requestResult(store.getAll() as IDBRequest<StoredLocalModuleEntry[]>),
  )
    .then((rows) => {
      let added = false;
      for (const row of rows) {
        const parsed = ContentModuleCatalogEntrySchema.safeParse(row.entry);
        if (!parsed.success) {
          console.warn(`The stored descriptor of ${row.key} is invalid and is ignored.`);
          continue;
        }
        if (!entries.has(row.key)) {
          entries.set(row.key, parsed.data);
          added = true;
        }
      }
      if (added) notify();
    })
    .catch((cause: unknown) => {
      console.warn('Modules installed from files could not be listed.', cause);
    });
  return loading;
}

export async function saveLocalModuleEntry(entry: ContentModuleCatalogEntry): Promise<void> {
  const key = entryKey(entry.id, entry.version);
  const row: StoredLocalModuleEntry = {
    key,
    moduleId: entry.id,
    version: entry.version,
    importedAt: new Date().toISOString(),
    entry,
  };
  if (storageAvailable()) {
    await withStore('readwrite', async (store) => {
      store.put(row);
    });
  }
  entries.set(key, entry);
  notify();
}

/** Drops the stored descriptors of a module except the listed versions. */
export async function removeLocalModuleEntries(
  moduleId: string,
  keepVersions: ReadonlySet<string>,
): Promise<void> {
  await loadLocalModuleEntries();
  const doomed = [...entries.values()]
    .filter((entry) => entry.id === moduleId && !keepVersions.has(entry.version))
    .map((entry) => entryKey(entry.id, entry.version));
  if (doomed.length === 0) return;
  if (storageAvailable()) {
    await withStore('readwrite', async (store) => {
      for (const key of doomed) store.delete(key);
    });
  }
  for (const key of doomed) entries.delete(key);
  notify();
}

/** Adds the entries whose id the catalog does not know: a public module always wins. */
export function mergeLocalModuleEntries(
  catalog: ContentModuleCatalog,
  extra: readonly ContentModuleCatalogEntry[],
): ContentModuleCatalog {
  if (extra.length === 0) return catalog;
  const known = new Set(catalog.modules.map((module) => module.id));
  const added = extra.filter((entry) => !known.has(entry.id));
  return added.length === 0 ? catalog : { ...catalog, modules: [...catalog.modules, ...added] };
}

export function resetLocalModuleEntriesForTests(): void {
  entries.clear();
  listeners.clear();
  loading = null;
}
