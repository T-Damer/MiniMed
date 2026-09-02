import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendEvent,
  createManualMeasurementEvent,
  createPatientProfile,
  createToolResultEvent,
  emptyPatientVaultSnapshot,
  type PatientVaultSnapshot,
} from '@/state/patient-domain';
import {
  addPatientBlob,
  createPatientVault,
  deletePatientFromVault,
  deletePatientVault,
  exportPatientVaultBackup,
  importPatientVaultBackup,
  isPatientVaultUnlocked,
  lockPatientVault,
  PatientVaultError,
  patientVaultExists,
  patientVaultStorageMode,
  readPatientBlob,
  readPatientVault,
  unlockPatientVault,
  updatePatientVault,
  writePatientVault,
} from '@/state/patient-vault';

const nativeBridge = vi.hoisted(() => {
  let rawKey = new Uint8Array();
  const base64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  return {
    native: false,
    available: false,
    deleteKey: vi.fn(async () => undefined),
    wrapKey: vi.fn(async (key: Uint8Array) => {
      rawKey = key.slice();
      return {
        ivBase64: base64(new Uint8Array(12).fill(1)),
        ciphertextBase64: base64(new Uint8Array(48).fill(2)),
      };
    }),
    unwrapKey: vi.fn(async () => rawKey.slice()),
  };
});

vi.mock('@/state/patient-vault-native', () => ({
  deletePatientVaultNativeKey: nativeBridge.deleteKey,
  isNativePatientVaultKeychainAvailable: async () => nativeBridge.available,
  isPatientVaultNativePlatform: () => nativeBridge.native,
  unwrapPatientVaultKey: nativeBridge.unwrapKey,
  wrapPatientVaultKey: nativeBridge.wrapKey,
}));

type Listener = (() => void) | null;

interface FakeRequest<T> {
  result: T;
  error: Error | null;
  onsuccess: Listener;
  onerror: Listener;
  onupgradeneeded: Listener;
  onblocked?: Listener;
}

interface FakeObjectStore {
  get: (key: string) => FakeRequest<unknown>;
  getAll: () => FakeRequest<unknown[]>;
  put: (value: unknown, key?: string) => void;
  delete: (key: string) => void;
  clear: () => void;
}

interface FakeTransaction {
  error: Error | null;
  oncomplete: Listener;
  onerror: Listener;
  onabort: Listener;
  objectStore: (name: string) => FakeObjectStore;
}

interface FakeDatabase {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string, options?: { keyPath?: string }) => void;
  close: () => void;
  transaction: (names: string | string[], mode?: string) => FakeTransaction;
}

interface FakeVaultDatabase {
  stores: Map<string, Map<string, unknown>>;
  failNextReadwrite: boolean;
  indexedDB: {
    open: (name: string, version: number) => FakeRequest<FakeDatabase>;
    deleteDatabase: (name: string) => FakeRequest<undefined>;
  };
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function installIndexedDbDouble(): FakeVaultDatabase {
  const state: FakeVaultDatabase = {
    stores: new Map(),
    failNextReadwrite: false,
    indexedDB: undefined as never,
  };

  const createTransaction = (names: string | string[], mode = 'readonly'): FakeTransaction => {
    const transaction: FakeTransaction = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: (name) => {
        const store = storesForTransaction.get(name);
        if (!store) throw new Error(`Unknown store ${name}`);
        return store;
      },
    };
    const storesForTransaction = new Map<string, FakeObjectStore>();
    let pending = 0;
    let completionQueued = false;
    let aborted = false;
    const shouldFail = mode === 'readwrite' && state.failNextReadwrite;
    if (shouldFail) state.failNextReadwrite = false;

    const finishIfIdle = (): void => {
      if (pending !== 0 || completionQueued || aborted) return;
      completionQueued = true;
      queueMicrotask(() => transaction.oncomplete?.());
    };
    const abort = (error: Error): void => {
      if (aborted) return;
      aborted = true;
      queueMicrotask(() => {
        transaction.error = error;
        transaction.onabort?.();
        transaction.onerror?.();
      });
    };
    const schedule = (work: () => void): void => {
      pending += 1;
      queueMicrotask(() => {
        if (!aborted) {
          try {
            work();
          } catch (error) {
            abort(error instanceof Error ? error : new Error(String(error)));
          }
        }
        pending -= 1;
        finishIfIdle();
      });
    };

    for (const name of typeof names === 'string' ? [names] : names) {
      const store = state.stores.get(name);
      if (!store) throw new Error(`Unknown store ${name}`);
      storesForTransaction.set(name, {
        get: (key) => {
          const request = fakeRequest<unknown>(undefined);
          schedule(() => {
            request.result = copy(store.get(key));
            request.onsuccess?.();
          });
          return request;
        },
        getAll: () => {
          const request = fakeRequest<unknown[]>([]);
          schedule(() => {
            request.result = [...store.values()].map(copy);
            request.onsuccess?.();
          });
          return request;
        },
        put: (value, key) => {
          schedule(() => {
            if (shouldFail) throw new Error('simulated transaction failure');
            const record = copy(value) as { readonly id?: unknown };
            const recordKey = key ?? (typeof record.id === 'string' ? record.id : undefined);
            if (!recordKey) throw new Error('missing fake key');
            store.set(recordKey, record);
          });
        },
        delete: (key) => schedule(() => store.delete(key)),
        clear: () => schedule(() => store.clear()),
      });
    }
    if (shouldFail) queueMicrotask(() => abort(new Error('simulated transaction failure')));
    return transaction;
  };

  const database: FakeDatabase = {
    objectStoreNames: { contains: (name) => state.stores.has(name) },
    createObjectStore: (name) => {
      if (!state.stores.has(name)) state.stores.set(name, new Map());
    },
    close: () => undefined,
    transaction: createTransaction,
  };
  state.indexedDB = {
    open: () => {
      const request = fakeRequest(database);
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase: () => {
      const request = fakeRequest<undefined>(undefined);
      queueMicrotask(() => {
        state.stores.clear();
        request.onsuccess?.();
      });
      return request;
    },
  };
  vi.stubGlobal('indexedDB', state.indexedDB);
  return state;
}

function fakeRequest<T>(result: T): FakeRequest<T> {
  return {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    onblocked: null,
  };
}

function patientSnapshotWithEvent(patientId: string, eventId: string): PatientVaultSnapshot {
  const profile = createPatientProfile({ id: patientId, displayName: patientId }).profile;
  return appendEvent(
    { ...emptyPatientVaultSnapshot(), profiles: [profile] },
    createManualMeasurementEvent({
      patientId,
      id: eventId,
      metricId: 'pulse',
      label: 'Пульс',
      value: 72,
      unit: 'уд/мин',
      occurredAt: '2026-08-29T10:00:00.000Z',
    }),
  );
}

describe('patient vault storage modes', () => {
  let fakeDatabase: FakeVaultDatabase;

  beforeEach(() => {
    fakeDatabase = installIndexedDbDouble();
    nativeBridge.native = false;
    nativeBridge.available = false;
    lockPatientVault();
  });

  afterEach(() => {
    lockPatientVault();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('drops the legacy DEV store and requires explicit plaintext consent on web', async () => {
    fakeDatabase.stores.set('envelope', new Map([['current', { legacy: true }]]));

    await expect(createPatientVault()).rejects.toMatchObject({ code: 'unavailable' });
    await createPatientVault({ allowUnencrypted: true });

    expect(fakeDatabase.stores.has('envelope')).toBe(false);
    expect(await patientVaultStorageMode()).toBe('unencrypted');
  });

  it('stores web snapshots as plaintext and reopens them without a password', async () => {
    await createPatientVault({ allowUnencrypted: true });
    await writePatientVault(patientSnapshotWithEvent('patient-visible', 'event-1'));

    const stored = JSON.stringify(fakeDatabase.stores.get('vault')?.get('current'));
    expect(stored).toContain('patient-visible');
    expect(stored).not.toContain('ciphertext');

    lockPatientVault();
    await unlockPatientVault();
    expect((await readPatientVault()).profiles[0]?.id).toBe('patient-visible');
  });

  it('encrypts native snapshots with a transparently wrapped Keystore key', async () => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    await createPatientVault();
    await writePatientVault(patientSnapshotWithEvent('patient-secret', 'event-1'));

    const stored = JSON.stringify(fakeDatabase.stores.get('vault')?.get('current'));
    expect(stored).not.toContain('patient-secret');
    expect(stored).toContain('ciphertext');
    expect(nativeBridge.wrapKey).toHaveBeenCalledOnce();

    lockPatientVault();
    await unlockPatientVault();
    expect((await readPatientVault()).profiles[0]?.id).toBe('patient-secret');
  });

  it('keeps the previous snapshot when a write transaction aborts', async () => {
    await createPatientVault({ allowUnencrypted: true });
    await writePatientVault(patientSnapshotWithEvent('patient-1', 'event-1'));
    fakeDatabase.failNextReadwrite = true;

    await expect(
      writePatientVault(patientSnapshotWithEvent('patient-2', 'event-2')),
    ).rejects.toBeInstanceOf(PatientVaultError);
    expect(isPatientVaultUnlocked()).toBe(false);
    await unlockPatientVault();
    expect((await readPatientVault()).profiles.map((profile) => profile.id)).toEqual(['patient-1']);
  });

  it('serializes concurrent snapshot updates', async () => {
    await createPatientVault({ allowUnencrypted: true });
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    await writePatientVault({ ...emptyPatientVaultSnapshot(), profiles: [profile] });
    const event = (id: string, value: number) =>
      createManualMeasurementEvent({
        patientId: profile.id,
        id,
        metricId: 'pulse',
        label: 'Пульс',
        value,
        unit: 'уд/мин',
      });

    await Promise.all([
      updatePatientVault((snapshot) => appendEvent(snapshot, event('event-1', 72))),
      updatePatientVault((snapshot) => appendEvent(snapshot, event('event-2', 74))),
    ]);

    expect((await readPatientVault()).events.map((item) => item.id)).toEqual([
      'event-1',
      'event-2',
    ]);
  });

  it('exports and imports an explicitly plaintext portable backup', async () => {
    await createPatientVault({ allowUnencrypted: true });
    await writePatientVault(patientSnapshotWithEvent('patient-1', 'event-1'));
    await addPatientBlob({
      id: 'blob-1',
      patientId: 'patient-1',
      mimeType: 'text/plain',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const backup = await exportPatientVaultBackup();
    expect(JSON.stringify(backup)).toContain('patient-1');

    await writePatientVault(emptyPatientVaultSnapshot());
    await importPatientVaultBackup(backup);
    expect((await readPatientVault()).events[0]?.id).toBe('event-1');
    await expect(readPatientBlob('blob-1')).resolves.toMatchObject({
      mimeType: 'text/plain',
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it('rejects unsafe source URLs before replacing the current snapshot', async () => {
    await createPatientVault({ allowUnencrypted: true });
    const profile = createPatientProfile({ id: 'patient-1', displayName: 'Тест' }).profile;
    const safeSnapshot = { ...emptyPatientVaultSnapshot(), profiles: [profile] };
    await writePatientVault(safeSnapshot);
    const backup = await exportPatientVaultBackup();
    const event = createToolResultEvent({
      id: 'unsafe-event',
      patientId: profile.id,
      title: 'Результат инструмента',
      provenance: {
        toolId: 'tool-1',
        toolVersion: '1.0.0',
        definitionVersion: '1.0.0',
        sourceIds: ['unsafe-source'],
        sourceLinks: [{ id: 'unsafe-source', title: 'Источник', url: 'javascript:alert(1)' }],
        idempotencyKey: 'unsafe-import',
        normalizedInputs: {},
        contextSnapshot: {},
      },
      observations: [],
    });

    await expect(
      importPatientVaultBackup({ ...backup, snapshot: appendEvent(safeSnapshot, event) }),
    ).rejects.toMatchObject({ code: 'integrity' });
    expect(isPatientVaultUnlocked()).toBe(false);
    await unlockPatientVault();
    expect((await readPatientVault()).events).toEqual([]);
  });

  it('deletes only blobs belonging to the deleted patient', async () => {
    await createPatientVault({ allowUnencrypted: true });
    const first = createPatientProfile({ id: 'patient-1', displayName: 'Первый' }).profile;
    const second = createPatientProfile({ id: 'patient-2', displayName: 'Второй' }).profile;
    await writePatientVault({ ...emptyPatientVaultSnapshot(), profiles: [first, second] });
    await addPatientBlob({
      id: 'blob-1',
      patientId: first.id,
      mimeType: 'text/plain',
      bytes: new Uint8Array([1]),
    });
    await addPatientBlob({
      id: 'blob-2',
      patientId: second.id,
      mimeType: 'text/plain',
      bytes: new Uint8Array([2]),
    });

    await deletePatientFromVault(first.id);
    expect((await readPatientVault()).profiles.map((profile) => profile.id)).toEqual(['patient-2']);
    await expect(readPatientBlob('blob-1')).resolves.toBeUndefined();
    await expect(readPatientBlob('blob-2')).resolves.toMatchObject({ bytes: new Uint8Array([2]) });
  });

  it('fully deletes the vault and device key', async () => {
    await createPatientVault({ allowUnencrypted: true });
    await deletePatientVault();
    expect(isPatientVaultUnlocked()).toBe(false);
    expect(await patientVaultExists()).toBe(false);
    expect(nativeBridge.deleteKey).toHaveBeenCalled();
  });
});
