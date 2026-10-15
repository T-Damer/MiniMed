import { E5_MODEL_FILES, E5_MODEL_REVISION, type E5ModelFile } from './e5-model';

/**
 * Verified files of the pinned e5 query encoder. Written only by the main thread after a SHA-256
 * check; the search worker reads them through `readE5ModelFile` and never touches the network.
 */
const DATABASE_NAME = 'minimed-semantic-model-v1';
const FILE_STORE = 'files';

export interface StoredModelFile {
  readonly key: string;
  readonly sha256: string;
  readonly data: Blob;
}

export function fileKey(file: E5ModelFile): string {
  return `${E5_MODEL_REVISION}/${file.path}`;
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка локального хранилища.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(FILE_STORE, { keyPath: 'key' });
  };
  return requestResult(request);
}

export async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(FILE_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка записи модели.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Запись модели прервана.'));
    });
    const result = await action(transaction.objectStore(FILE_STORE));
    await done;
    return result;
  } finally {
    database.close();
  }
}

export async function storedFile(file: E5ModelFile): Promise<StoredModelFile | undefined> {
  return withStore('readonly', (store) =>
    requestResult(store.get(fileKey(file)) as IDBRequest<StoredModelFile | undefined>),
  );
}

export function validStored(file: E5ModelFile, stored: StoredModelFile | undefined): boolean {
  return stored?.sha256 === file.sha256 && stored.data.size === file.sizeBytes;
}

/** Deletes stored files of any other model revision (an earlier query encoder). */
export async function removeStaleModelFiles(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const current = new Set(E5_MODEL_FILES.map(fileKey));
  await withStore('readwrite', async (store) => {
    const keys = await requestResult(store.getAllKeys());
    for (const key of keys) {
      if (typeof key === 'string' && !current.has(key)) await requestResult(store.delete(key));
    }
  });
}

/** The verified bytes of one pinned file, or null while the model is not installed. */
export async function readE5ModelFile(path: string): Promise<Blob | null> {
  const file = E5_MODEL_FILES.find((candidate) => candidate.path === path);
  if (!file) return null;
  const stored = await storedFile(file);
  return validStored(file, stored) && stored ? stored.data : null;
}

/**
 * Deletes the whole downloaded copy (≈130 MB) once the bundled model has answered a query. Nothing
 * is created or opened when the database does not exist; resolves true when it was deleted.
 */
export async function discardDownloadedE5Model(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
  const known = await indexedDB.databases();
  if (!known.some((database) => database.name === DATABASE_NAME)) return false;
  await requestResult(indexedDB.deleteDatabase(DATABASE_NAME));
  return true;
}

/** Whether every pinned file of the downloaded copy is stored and verified (not the bundled one). */
export async function isDownloadedE5ModelInstalled(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  for (const file of E5_MODEL_FILES) {
    if (!validStored(file, await storedFile(file))) return false;
  }
  return true;
}
