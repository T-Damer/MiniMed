import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewExtractorMock = vi.hoisted(() => ({
  forFile: vi.fn(async () => 'data:image/jpeg;base64,thumb'),
}));
const downloadWithRetryMock = vi.hoisted(() => ({
  downloadWithRetry: vi.fn(),
}));

vi.mock('@/state/user-library-ingest', () => ({
  processNewDocument: vi.fn(async () => undefined),
  ensureUserLibraryIngestRunning: vi.fn(),
}));

vi.mock('@/state/thumbnails', () => ({ previewExtractor: previewExtractorMock }));
vi.mock('@/features/network/download-retry', () => downloadWithRetryMock);

import {
  addUserLibraryFile,
  buildUserLibraryImagePdf,
  createUserLibraryFolder,
  downloadUserLibraryExample,
  getUserLibraryFile,
  getUserLibraryMedicalAnnotationBitmap,
  getUserLibraryMedicalAnnotations,
  getUserLibraryThumbnail,
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
  setUserLibraryDocumentColor,
  setUserLibraryFolderColor,
  USER_LIBRARY_BOOKS_FOLDER_ID,
  USER_LIBRARY_BOOKS_FOLDER_TITLE,
  USER_LIBRARY_EXAMPLE_SLOTS,
  USER_LIBRARY_NOTES_FOLDER_ID,
  USER_LIBRARY_QUESTIONNAIRE_MIME_TYPE,
  USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID,
  USER_LIBRARY_RESEARCH_FOLDER_ID,
  USER_LIBRARY_RESEARCH_FOLDER_TITLE,
  USER_LIBRARY_TEMPLATES_FOLDER_ID,
  USER_LIBRARY_TEMPLATES_FOLDER_TITLE,
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
    previewExtractorMock.forFile.mockClear();
    downloadWithRetryMock.downloadWithRetry.mockReset();
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

  it('creates protected notes, templates, and questionnaires folders', async () => {
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
    expect(folders).toContainEqual(
      expect.objectContaining({
        id: USER_LIBRARY_TEMPLATES_FOLDER_ID,
        title: USER_LIBRARY_TEMPLATES_FOLDER_TITLE,
        parentId: null,
        isSystem: true,
      }),
    );
    await expect(removeUserLibraryFolder(USER_LIBRARY_TEMPLATES_FOLDER_ID)).rejects.toThrow(
      'нельзя удалить',
    );
    expect(folders).toContainEqual(
      expect.objectContaining({
        id: USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID,
        title: 'Опросники',
        parentId: null,
        isSystem: true,
      }),
    );
    await expect(removeUserLibraryFolder(USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID)).rejects.toThrow(
      'нельзя удалить',
    );
  });

  it('creates the default books and research folders once', async () => {
    installUserLibraryIndexedDb();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });

    const folders = await listUserLibraryFolders();
    expect(folders).toContainEqual(
      expect.objectContaining({
        id: USER_LIBRARY_BOOKS_FOLDER_ID,
        title: USER_LIBRARY_BOOKS_FOLDER_TITLE,
        parentId: null,
      }),
    );
    expect(folders).toContainEqual(
      expect.objectContaining({
        id: USER_LIBRARY_RESEARCH_FOLDER_ID,
        title: USER_LIBRARY_RESEARCH_FOLDER_TITLE,
        parentId: null,
      }),
    );
    expect(await listUserLibraryFolders()).toEqual(folders);
  });

  it('persists colors for documents and folders', async () => {
    installUserLibraryIndexedDb();
    const folder = await createUserLibraryFolder('Цветная папка');
    const document = await addUserLibraryFile(new File(['content'], 'case.txt'));

    await setUserLibraryDocumentColor(document.id, 'blue');
    await setUserLibraryFolderColor(folder.id, 'purple');
    expect(await listUserLibraryDocuments()).toContainEqual(
      expect.objectContaining({ id: document.id, color: 'blue' }),
    );
    expect(await listUserLibraryFolders()).toContainEqual(
      expect.objectContaining({ id: folder.id, color: 'purple' }),
    );

    await setUserLibraryDocumentColor(document.id, null);
    await setUserLibraryFolderColor(folder.id, null);
    expect((await listUserLibraryDocuments()).find((item) => item.id === document.id)?.color).toBe(
      undefined,
    );
    expect((await listUserLibraryFolders()).find((item) => item.id === folder.id)?.color).toBe(
      undefined,
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

  it('keeps questionnaire contents synchronized with a file rename', async () => {
    installUserLibraryIndexedDb();
    const created = await addUserLibraryFile(
      new File(
        [JSON.stringify({ format: 'minimed-questionnaire', title: 'Исходное название' })],
        'Исходное название.minimed-questionnaire',
        { type: USER_LIBRARY_QUESTIONNAIRE_MIME_TYPE },
      ),
      USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID,
      undefined,
      { skipProcessing: true },
    );

    await renameUserLibraryDocument(created.id, 'Новое название');

    const renamed = (await listUserLibraryDocuments()).find((item) => item.id === created.id);
    expect(renamed).toMatchObject({
      title: 'Новое название',
      fileName: 'Новое название.minimed-questionnaire',
    });
    const file = await getUserLibraryFile(created.id);
    if (!file) throw new Error('Переименованный опросник не найден.');
    expect(JSON.parse(await file.text())).toMatchObject({ title: 'Новое название' });
  });

  it('extracts and persists a thumbnail beside the original file', async () => {
    installUserLibraryIndexedDb();
    const file = new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' });
    const created = await addUserLibraryFile(file);

    await vi.waitFor(async () => {
      expect(await getUserLibraryThumbnail(created.id)).toBe('data:image/jpeg;base64,thumb');
    });
    expect(previewExtractorMock.forFile).toHaveBeenCalledWith(
      expect.any(File),
      'application/pdf',
      'scan.pdf',
    );
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

  it('declares GitHub Release sources for CT, MRI and EPUB example slots', () => {
    expect(USER_LIBRARY_EXAMPLE_SLOTS).toEqual([
      expect.objectContaining({
        id: 'ct',
        folderId: USER_LIBRARY_RESEARCH_FOLDER_ID,
        fileName: 'Пример КТ.dcm',
      }),
      expect.objectContaining({
        id: 'mri',
        folderId: USER_LIBRARY_RESEARCH_FOLDER_ID,
        fileName: 'Пример МРТ.nii',
      }),
      expect.objectContaining({
        id: 'epub',
        folderId: USER_LIBRARY_BOOKS_FOLDER_ID,
        fileName: "Alice's Adventures in Wonderland.epub",
      }),
    ]);
    for (const slot of USER_LIBRARY_EXAMPLE_SLOTS) {
      expect(slot.url).toMatch(
        /^https:\/\/github\.com\/T-Damer\/MiniMed\/releases\/download\/v\d+\.\d+\.\d+\//u,
      );
      expect(slot.browserUrl).toContain('https://raw.githubusercontent.com/T-Damer/MiniMed/v');
      expect(slot.expectedBytes).toBeGreaterThan(0);
    }
  });

  it('downloads an example release asset and reports progress', async () => {
    installUserLibraryIndexedDb();
    const bytes = new Uint8Array(132);
    bytes.set(new TextEncoder().encode('DICM'), 128);
    downloadWithRetryMock.downloadWithRetry.mockImplementationOnce(
      async (options: {
        readonly onProgress?: (progress: {
          readonly downloadedBytes: number;
          readonly totalBytes: number | null;
        }) => void;
      }) => {
        options.onProgress?.({ downloadedBytes: bytes.byteLength, totalBytes: bytes.byteLength });
        return bytes;
      },
    );
    const progress: number[] = [];
    const slot = USER_LIBRARY_EXAMPLE_SLOTS.find((item) => item.id === 'ct');
    if (!slot) throw new Error('CT example slot is missing.');

    const created = await downloadUserLibraryExample(slot, (value) => progress.push(value));

    expect(downloadWithRetryMock.downloadWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({ url: slot.browserUrl, expectedBytes: slot.expectedBytes }),
    );
    expect(created.exampleId).toBe('ct');
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.some((value) => value > 0 && value < 1)).toBe(true);
  });

  it('does not download an example twice after it is stored', async () => {
    installUserLibraryIndexedDb();
    const bytes = new Uint8Array(132);
    bytes.set(new TextEncoder().encode('DICM'), 128);
    downloadWithRetryMock.downloadWithRetry.mockImplementation(async () => bytes);
    const slot = USER_LIBRARY_EXAMPLE_SLOTS.find((item) => item.id === 'ct');
    if (!slot) throw new Error('CT example slot is missing.');

    const first = await downloadUserLibraryExample(slot);
    const second = await downloadUserLibraryExample(slot);

    expect(second.id).toBe(first.id);
    expect(downloadWithRetryMock.downloadWithRetry).toHaveBeenCalledTimes(1);
    expect(
      (await listUserLibraryDocuments()).filter((item) => item.exampleId === 'ct'),
    ).toHaveLength(1);
  });

  it('reports when an example is missing from the GitHub Release', async () => {
    const slot = USER_LIBRARY_EXAMPLE_SLOTS[0];
    downloadWithRetryMock.downloadWithRetry.mockRejectedValueOnce(
      new Error('Сервер ответил HTTP 404.'),
    );

    await expect(downloadUserLibraryExample(slot)).rejects.toThrow(
      'Пример «Пример КТ» ещё не опубликован в GitHub Release.',
    );
  });

  it('stores the example slot and reports upload progress', async () => {
    installUserLibraryIndexedDb();
    const bytes = new Uint8Array(132);
    bytes.set(new TextEncoder().encode('DICM'), 128);
    const progress: number[] = [];
    const created = await addUserLibraryFile(
      new File([bytes], 'uploaded-ct.dcm', { type: 'application/dicom' }),
      USER_LIBRARY_RESEARCH_FOLDER_ID,
      undefined,
      { exampleId: 'ct', onProgress: (value) => progress.push(value) },
    );

    expect(created.exampleId).toBe('ct');
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.some((value) => value > 0 && value < 1)).toBe(true);
    expect(await listUserLibraryDocuments()).toContainEqual(
      expect.objectContaining({ id: created.id, exampleId: 'ct' }),
    );
    await expect(
      addUserLibraryFile(
        new File(['wrong'], 'wrong.epub', { type: 'application/epub+zip' }),
        USER_LIBRARY_RESEARCH_FOLDER_ID,
        undefined,
        { exampleId: 'ct' },
      ),
    ).rejects.toThrow('Файл не подходит');
  });
});
