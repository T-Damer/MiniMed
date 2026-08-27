import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/state/user-library-ingest', () => ({
  processNewDocument: vi.fn(async () => undefined),
  ensureUserLibraryIngestRunning: vi.fn(),
}));

import {
  addUserLibraryFile,
  buildUserLibraryImagePdf,
  ensureUserLibraryMedicalExamples,
  getUserLibraryMedicalAnnotationBitmap,
  getUserLibraryMedicalAnnotations,
  listUserLibraryDocuments,
  listUserLibraryFolders,
  listUserLibraryPages,
  patchUserLibraryDocument,
  putUserLibraryMedicalAnnotationBitmap,
  putUserLibraryMedicalAnnotations,
  putUserLibraryPage,
  removeUserLibraryFolder,
  renameUserLibraryDocument,
  searchUserLibrary,
  USER_LIBRARY_EXAMPLE_CT_FILE_NAME,
  USER_LIBRARY_EXAMPLE_MRI_FILE_NAME,
  USER_LIBRARY_NOTES_FOLDER_ID,
  userLibraryFileKind,
  userLibraryProgressFraction,
  userLibrarySearchableCount,
} from '@/state/user-library';

type StoreRecord = Record<string, unknown>;

function installUserLibraryIndexedDb(): void {
  const documents = new Map<string, StoreRecord>();
  const files = new Map<string, Blob>();
  const folders = new Map<string, StoreRecord>();
  const pages = new Map<string, StoreRecord>();
  const medicalAnnotations = new Map<string, StoreRecord>();

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
      if (storeName === 'folders') {
        const record = value as StoreRecord;
        folders.set(String(record['id']), record);
        return;
      }
      if (storeName === 'pages') {
        pages.set(String(key), value as StoreRecord);
        return;
      }
      if (storeName === 'medical-annotations') {
        const record = value as StoreRecord;
        medicalAnnotations.set(String(record['documentId']), record);
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
        else if (storeName === 'folders') request.result = folders.get(key);
        else if (storeName === 'pages') request.result = pages.get(key);
        else if (storeName === 'medical-annotations') request.result = medicalAnnotations.get(key);
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
        else if (storeName === 'folders') request.result = [...folders.values()];
        else if (storeName === 'pages') request.result = [...pages.values()];
        else request.result = [];
        request.onsuccess?.();
      }, 0);
      return request;
    },
    delete: (key: string) => {
      if (storeName === 'documents') documents.delete(key);
      else if (storeName === 'files') files.delete(key);
      else if (storeName === 'folders') folders.delete(key);
      else if (storeName === 'pages') pages.delete(key);
      else if (storeName === 'medical-annotations') medicalAnnotations.delete(key);
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

  it('builds one variable-size PDF page per image', () => {
    const pdf = buildUserLibraryImagePdf([
      { jpeg: new Uint8Array([1, 2, 3]), width: 1000, height: 500 },
      { jpeg: new Uint8Array([4, 5, 6]), width: 600, height: 900 },
    ]);
    const source = new TextDecoder().decode(pdf);

    expect(source.match(/\/Type \/Page /gu)).toHaveLength(2);
    expect(source).toContain('/Count 2');
    expect(source).toContain('/MediaBox [0 0 750 375]');
    expect(source).toContain('/MediaBox [0 0 450 675]');
    expect(source).toContain('xref\n0 9');
  });

  it('creates a protected notes folder', async () => {
    installUserLibraryIndexedDb();
    const folders = await listUserLibraryFolders();
    expect(folders).toContainEqual(
      expect.objectContaining({
        id: USER_LIBRARY_NOTES_FOLDER_ID,
        title: 'Заметки',
        parentId: null,
        isSystem: true,
      }),
    );
    await expect(removeUserLibraryFolder(USER_LIBRARY_NOTES_FOLDER_ID)).rejects.toThrow(
      'нельзя удалить',
    );
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
    const file = new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' });
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

  it('allows RTF, image and arbitrary binary uploads', async () => {
    installUserLibraryIndexedDb();
    const rtf = await addUserLibraryFile(
      new File(['{\\rtf1 тест}'], 'note.rtf', { type: 'text/rtf' }),
    );
    expect(rtf.mimeType).toBe('text/rtf');

    const image = await addUserLibraryFile(
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'scan.jpg', { type: 'image/jpeg' }),
    );
    expect(image.mimeType).toBe('image/jpeg');

    // Любой тип файла теперь принимается и хранится как документ-файл.
    const binary = await addUserLibraryFile(
      new File(['MZ'], 'tool.exe', { type: 'application/octet-stream' }),
    );
    expect(binary.mimeType).toBe('application/octet-stream');
    expect(binary.title).toBe('tool');
  });

  it('recognizes a DICOM Part 10 file as a medical image', async () => {
    installUserLibraryIndexedDb();
    const bytes = new Uint8Array(132);
    bytes.set(new TextEncoder().encode('DICM'), 128);
    const dicom = await addUserLibraryFile(
      new File([bytes], 'ct-slice.dcm', { type: 'application/octet-stream' }),
    );

    expect(dicom.mimeType).toBe('application/dicom');
    expect(userLibraryFileKind(dicom.mimeType, dicom.fileName)).toBe('dicom');
  });

  it('recognizes native medical volumes, including compressed NIfTI', async () => {
    installUserLibraryIndexedDb();
    const nifti = await addUserLibraryFile(
      new File([new Uint8Array([1, 2, 3])], 'brain.nii.gz', {
        type: 'application/gzip',
      }),
    );
    const nrrd = await addUserLibraryFile(
      new File([new TextEncoder().encode('NRRD0005')], 'scan.nrrd', {
        type: 'application/octet-stream',
      }),
    );

    expect(nifti.mimeType).toBe('application/x-nifti');
    expect(userLibraryFileKind(nifti.mimeType, nifti.fileName)).toBe('volume');
    expect(nrrd.mimeType).toBe('application/x-nrrd');
    expect(userLibraryFileKind(nrrd.mimeType, nrrd.fileName)).toBe('volume');
  });

  it('stores medical-image strokes per document and slice', async () => {
    installUserLibraryIndexedDb();
    const strokes = [
      {
        id: 'stroke-1',
        color: 'red' as const,
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.4 },
        ],
      },
    ];

    await putUserLibraryMedicalAnnotations('scan-1', 'dicom:7', strokes);

    expect(await getUserLibraryMedicalAnnotations('scan-1', 'dicom:7')).toEqual(strokes);
    expect(await getUserLibraryMedicalAnnotations('scan-1', 'dicom:8')).toEqual([]);
    await putUserLibraryMedicalAnnotations('scan-1', 'dicom:7', []);
    expect(await getUserLibraryMedicalAnnotations('scan-1', 'dicom:7')).toEqual([]);
  });

  it('stores a volume annotation bitmap beside slice annotations', async () => {
    installUserLibraryIndexedDb();
    const bitmap = new Uint8Array([0, 1, 3, 0]);

    await putUserLibraryMedicalAnnotationBitmap('volume-1', bitmap);
    expect(await getUserLibraryMedicalAnnotationBitmap('volume-1')).toEqual(bitmap);

    await putUserLibraryMedicalAnnotations('volume-1', 'dicom:1', [
      { id: 'stroke-1', color: 'blue', points: [{ x: 0.2, y: 0.4 }] },
    ]);
    expect(await getUserLibraryMedicalAnnotationBitmap('volume-1')).toEqual(bitmap);

    await putUserLibraryMedicalAnnotationBitmap('volume-1', new Uint8Array(4));
    expect(await getUserLibraryMedicalAnnotationBitmap('volume-1')).toBeNull();
  });

  it('adds the bundled CT and MRI examples only once', async () => {
    installUserLibraryIndexedDb();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const bytes = new Uint8Array(132);
    bytes.set(new TextEncoder().encode('DICM'), 128);
    const fetchSample = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([bytes], { type: 'application/dicom' }),
    }));
    vi.stubGlobal('fetch', fetchSample);

    expect(await ensureUserLibraryMedicalExamples()).toBe(true);
    expect(await ensureUserLibraryMedicalExamples()).toBe(false);
    expect(
      (await listUserLibraryDocuments()).filter(
        (document) => document.fileName === USER_LIBRARY_EXAMPLE_CT_FILE_NAME,
      ),
    ).toHaveLength(1);
    expect(
      (await listUserLibraryDocuments()).filter(
        (document) => document.fileName === USER_LIBRARY_EXAMPLE_MRI_FILE_NAME,
      ),
    ).toHaveLength(1);
    expect(fetchSample).toHaveBeenCalledTimes(2);
  });

  it('upgrades the previous CT example without rewriting the real MRI', async () => {
    installUserLibraryIndexedDb();
    const storage = new Map([
      ['minimed.userLibrary.medicalExamplesSeeded.v2', '1'],
      ['minimed.userLibrary.medicalExamplesSeeded.v3', '1'],
      ['minimed.userLibrary.medicalExamplesSeeded.v4', '1'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const previousCt = new Uint8Array(132);
    previousCt.set(new TextEncoder().encode('DICM'), 128);
    const previousMri = new Uint8Array(136);
    await addUserLibraryFile(
      new File([previousCt], USER_LIBRARY_EXAMPLE_CT_FILE_NAME, {
        type: 'application/dicom',
      }),
    );
    await addUserLibraryFile(
      new File([previousMri], USER_LIBRARY_EXAMPLE_MRI_FILE_NAME, {
        type: 'application/x-nifti',
      }),
    );
    const replacement = new Uint8Array(140);
    replacement.set(new TextEncoder().encode('DICM'), 128);
    const fetchSample = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([replacement]),
    }));
    vi.stubGlobal('fetch', fetchSample);

    expect(await ensureUserLibraryMedicalExamples()).toBe(true);
    const examples = (await listUserLibraryDocuments()).filter((document) =>
      [USER_LIBRARY_EXAMPLE_CT_FILE_NAME, USER_LIBRARY_EXAMPLE_MRI_FILE_NAME].includes(
        document.fileName,
      ),
    );
    expect(examples).toHaveLength(2);
    expect(
      examples.find((document) => document.fileName === USER_LIBRARY_EXAMPLE_CT_FILE_NAME)
        ?.byteLength,
    ).toBe(replacement.byteLength);
    expect(
      examples.find((document) => document.fileName === USER_LIBRARY_EXAMPLE_MRI_FILE_NAME)
        ?.byteLength,
    ).toBe(previousMri.byteLength);
    expect(fetchSample).toHaveBeenCalledTimes(1);
  });
});
