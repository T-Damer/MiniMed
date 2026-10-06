import type { ContentModuleCatalogCache, ContentModuleCatalogCacheRecord } from '@localmed/core';

/**
 * Device-local copy of the last remote module catalog, kept in IndexedDB. The catalog is several
 * megabytes, far over what `localStorage` accepts (it throws QuotaExceededError), so the previous
 * localStorage record never persisted and every start downloaded the whole catalog again.
 *
 * One record under one key. The catalog travels as its JSON text: storing the text is much cheaper
 * to clone than a large object graph, and it is validated by the core when read back.
 */
export const CATALOG_CACHE_DATABASE = 'minimed-module-catalog';
export const CATALOG_CACHE_STORE = 'records';
export const CATALOG_CACHE_RECORD_KEY = 'preview';
/** The localStorage key of the retired cache; its record is removed, never migrated. */
export const LEGACY_CATALOG_CACHE_KEY = 'minimed.content-module-catalog.preview.v1';

interface StoredCatalogRecord {
  readonly key: string;
  readonly format: number;
  readonly appVersion: string;
  readonly publishedAt: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly fetchedAt: string;
  readonly catalogJson: string | null;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Ошибка локального хранилища каталога.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(CATALOG_CACHE_DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(CATALOG_CACHE_STORE, { keyPath: 'key' });
  };
  return requestResult(request);
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CATALOG_CACHE_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Ошибка записи каталога модулей.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Запись каталога модулей прервана.'));
    });
    const result = await action(transaction.objectStore(CATALOG_CACHE_STORE));
    await done;
    return result;
  } finally {
    database.close();
  }
}

function isStoredRecord(value: unknown): value is StoredCatalogRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, unknown>>;
  const nullableText = (field: unknown): boolean => field === null || typeof field === 'string';
  return (
    record['key'] === CATALOG_CACHE_RECORD_KEY &&
    typeof record['format'] === 'number' &&
    typeof record['appVersion'] === 'string' &&
    typeof record['publishedAt'] === 'string' &&
    typeof record['fetchedAt'] === 'string' &&
    nullableText(record['etag']) &&
    nullableText(record['lastModified']) &&
    nullableText(record['catalogJson'])
  );
}

export class IndexedDbContentModuleCatalogCache implements ContentModuleCatalogCache {
  /** The raw record, or null when nothing is stored; a damaged record is removed and reported. */
  public async read(): Promise<unknown | null> {
    const stored = await withStore('readonly', (store) =>
      requestResult(store.get(CATALOG_CACHE_RECORD_KEY) as IDBRequest<unknown>),
    );
    if (stored === undefined) return null;
    if (!isStoredRecord(stored)) {
      await this.clear();
      throw new Error('Сохранённый каталог модулей повреждён и удалён.');
    }
    let catalog: unknown = null;
    if (stored.catalogJson !== null) {
      try {
        catalog = JSON.parse(stored.catalogJson) as unknown;
      } catch (cause) {
        await this.clear();
        throw new Error('Сохранённый каталог модулей повреждён и удалён.', { cause });
      }
    }
    return {
      format: stored.format,
      appVersion: stored.appVersion,
      catalog,
      publishedAt: stored.publishedAt,
      etag: stored.etag,
      lastModified: stored.lastModified,
      fetchedAt: stored.fetchedAt,
    };
  }

  public async write(record: ContentModuleCatalogCacheRecord): Promise<void> {
    const stored: StoredCatalogRecord = {
      key: CATALOG_CACHE_RECORD_KEY,
      format: record.format,
      appVersion: record.appVersion,
      publishedAt: record.publishedAt,
      etag: record.etag,
      lastModified: record.lastModified,
      fetchedAt: record.fetchedAt,
      catalogJson: record.catalog ? JSON.stringify(record.catalog) : null,
    };
    await withStore('readwrite', async (store) => {
      // Completion is the transaction's: `withStore` resolves only after it commits.
      store.put(stored);
    });
  }

  public async clear(): Promise<void> {
    await withStore('readwrite', async (store) => {
      store.delete(CATALOG_CACHE_RECORD_KEY);
    });
  }
}

/**
 * Removes the record the app used to keep in localStorage. It is only deleted: it was written by a
 * build whose writes failed for the real catalog size, and a valid old record would be older than
 * the bundled catalog anyway.
 */
export function removeLegacyCatalogRecord(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(LEGACY_CATALOG_CACHE_KEY);
}
