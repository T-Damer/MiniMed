import { Capacitor } from '@capacitor/core';
import type { MedicalStore } from '@localmed/storage';
import { CapacitorMedicalStore, LocalMedDatabase } from '@localmed/storage-capacitor';
import { SQLITE_WASM_DESERIALIZE_MAX_BYTES, SqliteMedicalStore } from '@localmed/storage-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  builtInCompanionMounts,
  createNativeStore,
  createRequiredWebCoreStore,
  hasSqliteHeader,
  shouldOpenPackagedMedicationsInSearchWorker,
  shouldOpenPackagedWasmCompanion,
} from '@/composition/create-browser-core';
import { WorkerOpfsMedicalStore } from '@/composition/worker-opfs-medical-store';

vi.mock('@localmed/storage-capacitor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@localmed/storage-capacitor')>()),
  LocalMedDatabase: {
    hasCorePack: vi.fn(),
    downloadCorePack: vi.fn(),
    addListener: vi.fn(),
  },
}));

function store(): MedicalStore {
  return {} as MedicalStore;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Android core first launch', () => {
  it('waits for the download action, forwards progress, and reuses an installed core offline', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ outputChecksum: `sha256:${'a'.repeat(64)}` })),
      ),
    );
    vi.spyOn(CapacitorMedicalStore.prototype, 'initialize').mockResolvedValue({
      schemaVersion: 1,
      sqliteVersion: '3',
      fts5Available: true,
      contentPackIds: [],
      documentCount: 1,
      backend: 'sqlite-native',
      persistent: true,
      installation: 'reused',
      sizeBytes: 512,
    });
    vi.mocked(LocalMedDatabase.hasCorePack).mockResolvedValue({ installed: false });
    const remove = vi.fn(async () => undefined);
    const onProgress = vi.fn();
    vi.mocked(LocalMedDatabase.addListener).mockImplementation(async (_event, listener) => {
      listener({ loaded: 128, total: 512 });
      return { remove };
    });
    vi.mocked(LocalMedDatabase.downloadCorePack).mockResolvedValue();
    let start: (() => void) | undefined;
    const requestDownload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          start = resolve;
        }),
    );
    const pending = createNativeStore({ requestDownload, onProgress });
    await vi.waitFor(() => expect(requestDownload).toHaveBeenCalledOnce());
    expect(LocalMedDatabase.downloadCorePack).not.toHaveBeenCalled();
    start?.();
    await pending;
    expect(LocalMedDatabase.downloadCorePack).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({ loaded: 128, total: 512 });
    expect(remove).toHaveBeenCalledOnce();
    vi.mocked(LocalMedDatabase.hasCorePack).mockResolvedValue({ installed: true });
    await createNativeStore({ requestDownload, onProgress });
    expect(requestDownload).toHaveBeenCalledOnce();
    expect(LocalMedDatabase.downloadCorePack).toHaveBeenCalledOnce();
    vi.mocked(LocalMedDatabase.hasCorePack).mockResolvedValue({ installed: false });
    vi.mocked(LocalMedDatabase.downloadCorePack).mockRejectedValue(new Error('checksum mismatch'));
    await expect(
      createNativeStore({ requestDownload: async () => undefined, onProgress }),
    ).rejects.toThrow('checksum mismatch');
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe('createRequiredWebCoreStore', () => {
  it('opens a declared oversized core directly through the OPFS worker without GET', async () => {
    const opfsStore = store();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, {
          headers: {
            'Content-Length': String(SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1),
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const open = vi
      .spyOn(WorkerOpfsMedicalStore, 'open')
      .mockResolvedValue(opfsStore as WorkerOpfsMedicalStore);
    const createFromBytes = vi.spyOn(SqliteMedicalStore, 'createFromBytes');

    const result = await createRequiredWebCoreStore('https://example.test/app/');

    expect(result).toBe(opfsStore);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('HEAD');
    expect(createFromBytes).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith({
      url: 'https://example.test/app/content/core.db',
      databaseName: 'core.db',
      fetchTimeoutMs: 180_000,
      poolName: 'minimed-sah-core',
    });
  });

  it('opens the verified native file through a checksum-specific OPFS identity for the fallback', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(null, {
          headers: { 'Content-Length': String(SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1) },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const open = vi
      .spyOn(WorkerOpfsMedicalStore, 'open')
      .mockResolvedValue(store() as WorkerOpfsMedicalStore);
    const url = 'https://localhost/_capacitor_file_/data/localmed/content/core.db';
    await createRequiredWebCoreStore('https://localhost/', url, 'core.verified-sha.db');
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ url, databaseName: 'core.verified-sha.db' }),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(url);
  });

  it('keeps a small required core in SQLite WASM', async () => {
    const bytes = new TextEncoder().encode('SQLite format 3\u0000small');
    const wasmStore = store();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { headers: { 'Content-Length': String(bytes.byteLength) } }),
      )
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal('fetch', fetchMock);
    const createFromBytes = vi
      .spyOn(SqliteMedicalStore, 'createFromBytes')
      .mockResolvedValue(wasmStore as SqliteMedicalStore);
    const open = vi.spyOn(WorkerOpfsMedicalStore, 'open');

    const result = await createRequiredWebCoreStore('https://example.test/app/');

    expect(result).toBe(wasmStore);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createFromBytes).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('moves an unexpectedly large GET response to OPFS through a revoked Blob URL', async () => {
    const buffer = new ArrayBuffer(SQLITE_WASM_DESERIALIZE_MAX_BYTES + 1);
    new Uint8Array(buffer).set(new TextEncoder().encode('SQLite format 3\u0000'));
    const opfsStore = store();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => buffer,
      } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:minimed-core');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const open = vi
      .spyOn(WorkerOpfsMedicalStore, 'open')
      .mockResolvedValue(opfsStore as WorkerOpfsMedicalStore);
    const createFromBytes = vi.spyOn(SqliteMedicalStore, 'createFromBytes');

    const result = await createRequiredWebCoreStore('https://example.test/app/');

    expect(result).toBe(opfsStore);
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({
      url: 'blob:minimed-core',
      databaseName: 'core.db',
      fetchTimeoutMs: 180_000,
      poolName: 'minimed-sah-core',
    });
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:minimed-core');
    expect(createFromBytes).not.toHaveBeenCalled();
  });

  it('rejects a required core whose GET response is not SQLite', async () => {
    const invalidBytes = new TextEncoder().encode('<!doctype html>');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { headers: { 'Content-Length': String(invalidBytes.byteLength) } }),
      )
      .mockResolvedValueOnce(new Response(invalidBytes));
    vi.stubGlobal('fetch', fetchMock);
    const createFromBytes = vi.spyOn(SqliteMedicalStore, 'createFromBytes');
    const open = vi.spyOn(WorkerOpfsMedicalStore, 'open');

    await expect(createRequiredWebCoreStore('https://example.test/app/')).rejects.toThrow(
      'core.db is not SQLite',
    );
    expect(createFromBytes).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('builtInCompanionMounts', () => {
  it('uses the packaged regulatory database when no downloaded replacement exists', () => {
    const mounts = builtInCompanionMounts(
      {
        mkbStore: store(),
        medicationsStore: store(),
        ambulatoryStore: store(),
        regulatoryStore: store(),
        referenceStore: store(),
      },
      new Set(),
    );

    expect(mounts.map((mount) => mount.moduleId)).toEqual([
      'minimed.mkb.ru',
      'minimed.medications.ru',
      'minimed.ambulatory.v1',
      'minimed.regulatory.pediatrics.ru',
      'minimed.reference.pediatrics.ru',
    ]);
  });

  it('does not mount the packaged regulatory copy beside an installed replacement', () => {
    const mounts = builtInCompanionMounts(
      {
        mkbStore: store(),
        medicationsStore: store(),
        ambulatoryStore: store(),
        regulatoryStore: store(),
        referenceStore: store(),
      },
      new Set(['minimed.regulatory.pediatrics.ru']),
    );

    expect(mounts.map((mount) => mount.moduleId)).toEqual([
      'minimed.mkb.ru',
      'minimed.medications.ru',
      'minimed.ambulatory.v1',
      'minimed.reference.pediatrics.ru',
    ]);
  });

  it('does not mount the packaged reference copy beside an installed replacement', () => {
    const mounts = builtInCompanionMounts(
      {
        mkbStore: store(),
        medicationsStore: store(),
        ambulatoryStore: store(),
        regulatoryStore: store(),
        referenceStore: store(),
      },
      new Set(['minimed.reference.pediatrics.ru']),
    );

    expect(mounts.map((mount) => mount.moduleId)).toEqual([
      'minimed.mkb.ru',
      'minimed.medications.ru',
      'minimed.ambulatory.v1',
      'minimed.regulatory.pediatrics.ru',
    ]);
  });
});

describe('hasSqliteHeader', () => {
  it('rejects an HTML fallback served for a missing database asset', () => {
    expect(hasSqliteHeader(new TextEncoder().encode('<!doctype html>'))).toBe(false);
  });

  it('accepts a SQLite database header', () => {
    expect(hasSqliteHeader(new TextEncoder().encode('SQLite format 3\u0000'))).toBe(true);
  });
});

describe('shouldOpenPackagedWasmCompanion', () => {
  it('refuses local-dev packs that cannot fit in sqlite-wasm memory', () => {
    expect(shouldOpenPackagedWasmCompanion('mkb.db', undefined, new Set())).toBe(false);
    expect(shouldOpenPackagedWasmCompanion('medications.db', undefined, new Set())).toBe(false);
    expect(shouldOpenPackagedWasmCompanion('ambulatory.db', undefined, new Set())).toBe(false);
  });

  it('allows an unsafe companion when it is explicitly allowlisted', () => {
    expect(
      shouldOpenPackagedWasmCompanion(
        'medications.db',
        421 * 1024 * 1024,
        new Set(['medications.db']),
      ),
    ).toBe(true);
  });

  it('allows small packaged companions below the WASM size cap', () => {
    expect(shouldOpenPackagedWasmCompanion('regulatory.db', 1_600_000)).toBe(true);
    expect(shouldOpenPackagedWasmCompanion('reference.db', 540_000)).toBe(true);
  });

  it('refuses an oversized companion even when it is not on the unsafe name list', () => {
    expect(shouldOpenPackagedWasmCompanion('regulatory.db', 40 * 1024 * 1024)).toBe(false);
  });

  it('does not reopen the Allmed pack inside the search worker', () => {
    expect(shouldOpenPackagedMedicationsInSearchWorker()).toBe(false);
  });
});
