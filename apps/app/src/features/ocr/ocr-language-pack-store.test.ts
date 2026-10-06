import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteOcrPackFiles,
  hasOcrPackFiles,
  OCR_TESSERACT_CACHE_PATH,
  ocrCacheKey,
  writeOcrPackFiles,
} from './ocr-language-pack-store';

/** One object store with the operations the module uses; a request settles on a later microtask. */
function installFakeIndexedDb(records: Map<string, unknown>): { readonly opened: string[] } {
  const opened: string[] = [];
  const settle = <T>(request: { onsuccess: (() => void) | null; result: T }, value: T): void => {
    queueMicrotask(() => {
      request.result = value;
      request.onsuccess?.();
    });
  };
  const store = {
    put: (value: unknown, key: string) => void records.set(key, value),
    delete: (key: string) => void records.delete(key),
    count: (key: string) => {
      const request = { result: 0, onsuccess: null as (() => void) | null, onerror: null };
      settle(request, records.has(key) ? 1 : 0);
      return request;
    },
  };
  vi.stubGlobal('indexedDB', {
    open: (name: string) => {
      opened.push(name);
      const request = {
        result: {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const transaction = {
              oncomplete: null as (() => void) | null,
              onerror: null,
              onabort: null,
              objectStore: () => store,
            };
            queueMicrotask(() => queueMicrotask(() => transaction.oncomplete?.()));
            return transaction;
          },
          close: () => undefined,
        },
        onsuccess: null as (() => void) | null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return { opened };
}

describe('OCR language pack store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the key layout tesseract.js reads with cacheMethod readOnly', () => {
    expect(ocrCacheKey('rus')).toBe(`${OCR_TESSERACT_CACHE_PATH}/rus.traineddata`);
    expect(OCR_TESSERACT_CACHE_PATH).toBe('minimed-ocr-tessdata-4.0.0');
  });

  it('writes the pack into the shared tesseract database and drops the pre-pack cache entries', async () => {
    const records = new Map<string, unknown>([
      ['./eng.traineddata', new Uint8Array(3)],
      ['./rus.traineddata', new Uint8Array(3)],
      ['someone-else', 'kept'],
    ]);
    const { opened } = installFakeIndexedDb(records);

    await writeOcrPackFiles(
      new Map([
        ['eng', new Uint8Array([1])],
        ['rus', new Uint8Array([2])],
      ]),
    );

    expect(opened).toEqual(['keyval-store']);
    expect([...records.keys()].sort()).toEqual(
      [ocrCacheKey('eng'), ocrCacheKey('rus'), 'someone-else'].sort(),
    );
  });

  it('reports presence only when every language is stored, and deletes only its own keys', async () => {
    const records = new Map<string, unknown>([['someone-else', 'kept']]);
    installFakeIndexedDb(records);

    expect(await hasOcrPackFiles(['eng', 'rus'])).toBe(false);
    await writeOcrPackFiles(new Map([['eng', new Uint8Array([1])]]));
    expect(await hasOcrPackFiles(['eng', 'rus'])).toBe(false);
    await writeOcrPackFiles(new Map([['rus', new Uint8Array([2])]]));
    expect(await hasOcrPackFiles(['eng', 'rus'])).toBe(true);

    await deleteOcrPackFiles(['eng', 'rus']);

    expect(await hasOcrPackFiles(['eng'])).toBe(false);
    expect(records.get('someone-else')).toBe('kept');
  });
});
