import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/state/user-library-ingest', () => ({
  processNewDocument: vi.fn(async () => undefined),
  ensureUserLibraryIngestRunning: vi.fn(),
}));

import {
  addUserLibraryFile,
  listUserLibraryDocuments,
  listUserLibraryPages,
  patchUserLibraryDocument,
  putUserLibraryPage,
  renameUserLibraryDocument,
  searchUserLibrary,
  userLibraryProgressFraction,
  userLibrarySearchableCount,
} from '@/state/user-library';

type StoreRecord = Record<string, unknown>;

function installUserLibraryIndexedDb(): void {
  const documents = new Map<string, StoreRecord>();
  const files = new Map<string, Blob>();
  const pages = new Map<string, StoreRecord>();

  const createObjectStore = (storeName: string) => ({
    put: (value: unknown, key?: string) => {
      if (storeName === 'documents') {
        const record = value as StoreRecord;
        documents.set(String((record as StoreRecord)['id']), record);
        return;
      }
      if (storeName === 'files') {
        files.set(String(key), value as Blob);
        return;
      }
      if (storeName === 'pages') {
        pages.set(String(key), value as StoreRecord);
      }
    },
    get: (key: string) => {
      const request = {
        result: undefined as unknown,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        if (storeName === 'documents') request.result = documents.get(key);
        else if (storeName === 'files') request.result = files.get(key);
        else if (storeName === 'pages') request.result = pages.get(key);
        request.onsuccess?.();
      }, 0);
      return request;
    },
    getAll: () => {
      const request = {
        result: [] as unknown[],
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        if (storeName === 'documents') request.result = [...documents.values()];
        else if (storeName === 'pages') request.result = [...pages.values()];
        else request.result = [];
        request.onsuccess?.();
      }, 0);
      return request;
    },
    delete: (key: string) => {
      if (storeName === 'documents') documents.delete(key);
      else if (storeName === 'files') files.delete(key);
      else if (storeName === 'pages') pages.delete(key);
    },
  });

  const createTransaction = (storeNames: string | string[]) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = {
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      objectStore: (name?: string) => createObjectStore(name ?? names[0] ?? 'documents'),
    };
    setTimeout(() => transaction.oncomplete?.(), 0);
    return transaction;
  };

  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => undefined,
          close: () => undefined,
          transaction: createTransaction,
        },
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      setTimeout(() => request.onsuccess?.(), 0);
      return request;
    },
  });

  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe('user-library storage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds a text file, renames it, and searches indexed text', async () => {
    installUserLibraryIndexedDb();
    const file = new File(['Пневмония у ребёнка и контрольный осмотр'], 'case.txt', {
      type: 'text/plain',
    });
    const created = await addUserLibraryFile(file);
    expect(created.status).toBe('inspecting');
    expect(created.fileName).toBe('case.txt');

    await renameUserLibraryDocument(created.id, 'Мой случай');
    const renamed = (await listUserLibraryDocuments()).find((item) => item.id === created.id);
    expect(renamed?.title).toBe('Мой случай');

    await putUserLibraryPage({
      documentId: created.id,
      pageIndex: 0,
      kind: 'native',
      text: 'Пневмония у ребёнка и контрольный осмотр',
    });
    await patchUserLibraryDocument(created.id, {
      pageCount: 1,
      nativeTextPages: 1,
      ocrNeededPages: 0,
      ocrDonePages: 0,
      status: 'ready',
    });

    const matches = await searchUserLibrary('пневмония ребенок');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.document.id).toBe(created.id);

    const genericHits = await searchUserLibrary('парацетамол детям');
    expect(genericHits).toHaveLength(0);

    const searchable = await userLibrarySearchableCount();
    expect(searchable).toBe(1);

    const pageList = await listUserLibraryPages(created.id);
    expect(pageList[0]?.kind).toBe('native');
  });

  it('tracks OCR progress fraction from native and OCR pages', async () => {
    installUserLibraryIndexedDb();
    const file = new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' });
    const created = await addUserLibraryFile(file);
    await patchUserLibraryDocument(created.id, {
      pageCount: 4,
      nativeTextPages: 1,
      ocrNeededPages: 3,
      ocrDonePages: 2,
      status: 'ocr',
    });
    const updated = (await listUserLibraryDocuments()).find((item) => item.id === created.id);
    expect(updated).toBeTruthy();
    expect(userLibraryProgressFraction(updated as NonNullable<typeof updated>)).toBe(0.75);
  });

  it('allows RTF and image uploads and rejects unsupported binaries', async () => {
    installUserLibraryIndexedDb();
    const rtf = await addUserLibraryFile(
      new File(['{\\rtf1 тест}'], 'note.rtf', { type: 'text/rtf' }),
    );
    expect(rtf.mimeType).toBe('text/rtf');

    const image = await addUserLibraryFile(
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'scan.jpg', { type: 'image/jpeg' }),
    );
    expect(image.mimeType).toBe('image/jpeg');

    await expect(
      addUserLibraryFile(new File(['MZ'], 'virus.exe', { type: 'application/octet-stream' })),
    ).rejects.toThrow('Поддерживаются PDF, текст, Office, книги (EPUB/FB2) и изображения.');
  });
});
