import { OCR_LANGUAGE_PACK_VERSION, type OcrLanguage } from './ocr-language-pack-catalog';

/**
 * Where the verified language files live. tesseract.js reads its language data from the default
 * `idb-keyval` store (database `keyval-store`, object store `keyval`, no key path) under the key
 * `<cachePath>/<lang>.traineddata`; with `cacheMethod: 'readOnly'` and this `cachePath` it uses
 * exactly the bytes stored here, never the network. The layout is part of tesseract.js 7's
 * contract (see `worker-script/browser/cache.js`); the unit test pins it.
 */
const DATABASE_NAME = 'keyval-store';
const STORE_NAME = 'keyval';

/** Namespaced by pack version so a new pack can never be read as the old one. */
export const OCR_TESSERACT_CACHE_PATH = `minimed-ocr-${OCR_LANGUAGE_PACK_VERSION}`;

/** Keys tesseract.js wrote itself while the files were still bundled; they are never read now. */
const LEGACY_KEYS: readonly string[] = ['eng', 'rus'].map(
  (language) => `./${language}.traineddata`,
);

export function ocrCacheKey(language: OcrLanguage): string {
  return `${OCR_TESSERACT_CACHE_PATH}/${language}.traineddata`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // No version, like idb-keyval: it must attach to a database tesseract.js has created before.
    const request = indexedDB.open(DATABASE_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть хранилище языкового пакета.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Ошибка хранилища языкового пакета.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Запись языкового пакета отменена.'));
  });
}

async function withStore(
  mode: IDBTransactionMode,
  operate: (store: IDBObjectStore) => void,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    operate(transaction.objectStore(STORE_NAME));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/**
 * Stores every file and drops the copies tesseract.js cached before the pack existed, in one
 * transaction: either the whole pack is there afterwards or the previous state is untouched.
 */
export async function writeOcrPackFiles(
  files: ReadonlyMap<OcrLanguage, Uint8Array>,
): Promise<void> {
  await withStore('readwrite', (store) => {
    for (const [language, bytes] of files) store.put(bytes, ocrCacheKey(language));
    for (const key of LEGACY_KEYS) store.delete(key);
  });
}

export async function deleteOcrPackFiles(languages: readonly OcrLanguage[]): Promise<void> {
  await withStore('readwrite', (store) => {
    for (const language of languages) store.delete(ocrCacheKey(language));
  });
}

/** Presence only: the bytes were verified when they were written, and reading 20 MB is not free. */
export async function hasOcrPackFiles(languages: readonly OcrLanguage[]): Promise<boolean> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const counts = languages.map(
      (language) =>
        new Promise<number>((resolve, reject) => {
          const request = store.count(ocrCacheKey(language));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(request.error ?? new Error('Не удалось проверить языковой пакет.'));
        }),
    );
    return (await Promise.all(counts)).every((count) => count === 1);
  } finally {
    database.close();
  }
}
