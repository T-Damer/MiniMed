import { CalculatorSchemaSchema } from '@localmed/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import { calculatorSchemaFromModules } from '@/features/calculators/tool-module-test-helpers';
import {
  deleteConversationTranscript,
  enableEncryptedVault,
  readConversationTranscript,
  saveDraftTranscript,
  transcriptBlobId,
  vaultOffer,
} from '@/features/conversations/conversation-transcript';
import {
  appendEvent,
  createManualMeasurementEvent,
  createPatientProfile,
  createToolResultEvent,
  emptyPatientVaultSnapshot,
  type PatientVaultSnapshot,
} from '@/state/patient-domain';
import {
  patientBoundCalculatorInputs,
  recordCalculatorResultForPatient,
} from '@/state/patient-tool-recording';
import {
  addPatientBlob,
  createPatientInVault,
  createPatientVault,
  deletePatientBlob,
  deletePatientFromVault,
  deletePatientVault,
  encryptPatientVault,
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
import coreClinical from '../../../../content/tool-modules/core-clinical.json';

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

  it('drops the legacy DEV store and creates an encrypted browser vault by default', async () => {
    fakeDatabase.stores.set('envelope', new Map([['current', { legacy: true }]]));

    await expect(createPatientVault()).resolves.toBe('browser-device-key');

    expect(fakeDatabase.stores.has('envelope')).toBe(false);
    expect(await patientVaultStorageMode()).toBe('browser-device-key');
  });

  it('offers plaintext only when the browser cannot keep an encryption key', async () => {
    const generate = vi
      .spyOn(globalThis.crypto.subtle, 'generateKey')
      .mockRejectedValueOnce(new Error('no key store'));
    await expect(createPatientVault()).rejects.toMatchObject({ code: 'unavailable' });
    expect(await patientVaultExists()).toBe(false);
    generate.mockRestore();

    await createPatientVault({ allowUnencrypted: true });
    expect(await patientVaultStorageMode()).toBe('unencrypted');
  });

  it('creates by name, captures a calculator and retains the card after locking', async () => {
    await expect(createPatientInVault({ displayName: 'Тест' })).rejects.toThrow();
    await createPatientVault({ allowUnencrypted: true });
    const created = await createPatientInVault({
      displayName: 'Тест',
      avatar: { kind: 'symbol', value: '🌿' },
    });
    const schema = CalculatorSchemaSchema.parse(
      coreClinical.tools.find((tool) => tool.id === 'body-surface-area-mosteller')?.definition,
    );
    const rawInputs = { heightCm: 170, weightKg: 65 };
    const evaluated = evaluateCalculatorSchema(schema, rawInputs);
    if (!evaluated.ok) throw new Error(evaluated.error);
    const input = {
      patientId: created.patientId,
      recordId: 'test-calculation',
      calculatorId: schema.id,
      calculatorVersion: '1',
      title: schema.title,
      schema,
      rawInputs,
      result: toStoredCalculationResult(evaluated),
    };
    await recordCalculatorResultForPatient(input);
    expect((await recordCalculatorResultForPatient(input)).created).toBe(false);
    lockPatientVault();
    const restored = await unlockPatientVault();
    expect(restored.profiles[0]?.avatar).toEqual({ kind: 'symbol', value: '🌿' });
    expect(restored.events).toHaveLength(1);
    expect(restored.events[0]?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: 'body-height', unit: 'см', value: 170 }),
        expect.objectContaining({ metricId: 'body-mass', unit: 'кг', value: 65 }),
      ]),
    );
  });

  it('keeps a due date in the card event and the dating input in the card context', async () => {
    await createPatientVault({ allowUnencrypted: true });
    const created = await createPatientInVault({ displayName: 'Беременная' });
    const schema = calculatorSchemaFromModules('obstetric-edd-lmp');
    const rawInputs = { lmpDate: '2026-05-01' };
    const evaluated = evaluateCalculatorSchema(schema, rawInputs);
    if (!evaluated.ok) throw new Error(evaluated.error);
    await recordCalculatorResultForPatient({
      patientId: created.patientId,
      recordId: 'edd-calculation',
      calculatorId: schema.id,
      calculatorVersion: '1.1.0',
      title: schema.title,
      schema,
      rawInputs,
      result: toStoredCalculationResult(evaluated),
    });
    lockPatientVault();
    const restored = await unlockPatientVault();
    expect(restored.events[0]?.text).toContain('5 февраля 2027');
    expect(restored.profiles[0]?.context).toEqual({
      lastMenstrualPeriod: '2026-05-01',
      estimatedDueDate: '2027-02-05',
    });
    expect(restored.events[0]?.provenance?.contextSnapshot).toMatchObject({
      estimatedDueDate: '2027-02-05',
    });
    // The stored due date fills the two calculators that start from it.
    const profile = restored.profiles[0];
    if (!profile) throw new Error('The card was not restored.');
    for (const [id, inputId] of [
      ['obstetric-ga-from-edd', 'eddDate'],
      ['obstetric-maternity-leave', 'eddDate'],
    ] as const) {
      expect(
        patientBoundCalculatorInputs(calculatorSchemaFromModules(id), profile, restored),
      ).toEqual({ [inputId]: '2027-02-05' });
    }
    expect(restored.events[0]?.observations.map((observation) => observation.metricId)).toEqual([
      'obstetric-edd-lmp.gaWeeks',
      'obstetric-edd-lmp.gaDaysRemainder',
    ]);
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

  it('deletes a single stored file by id', async () => {
    await createPatientVault({ allowUnencrypted: true });
    await addPatientBlob({ id: 'blob-1', mimeType: 'text/plain', bytes: new Uint8Array([1]) });
    await addPatientBlob({ id: 'blob-2', mimeType: 'text/plain', bytes: new Uint8Array([2]) });
    await deletePatientBlob('blob-1');
    await expect(readPatientBlob('blob-1')).resolves.toBeUndefined();
    await expect(readPatientBlob('blob-2')).resolves.toMatchObject({ bytes: new Uint8Array([2]) });
    lockPatientVault();
    await expect(deletePatientBlob('blob-2')).rejects.toMatchObject({ code: 'locked' });
  });

  it('keeps a conversation draft encrypted at rest and opens the device-key vault silently', async () => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    const lines = ['У пациента болит голова третий день', 'Давление сто сорок на девяносто'];
    const id = transcriptBlobId('conv-1');

    expect(await patientVaultExists()).toBe(false);
    await expect(saveDraftTranscript('conv-1', lines)).resolves.toBe('saved');
    expect(await patientVaultStorageMode()).toBe('native-keychain');
    const raw = JSON.stringify(fakeDatabase.stores.get('blobs')?.get(id));
    expect(raw).toContain('"storage":"encrypted"');
    expect(raw).not.toContain('болит');
    expect(raw).not.toContain('Давление');

    // A new session: closed vault, opened again with the device key, same text back.
    lockPatientVault();
    await expect(readConversationTranscript('conv-1')).resolves.toEqual({
      status: 'found',
      lines,
    });
    expect(isPatientVaultUnlocked()).toBe(true);

    await deleteConversationTranscript('conv-1');
    await expect(readConversationTranscript('conv-1')).resolves.toEqual({ status: 'none' });
  });

  it('never opens or fills a plaintext browser vault with a draft by itself', async () => {
    await expect(saveDraftTranscript('conv-1', ['текст'])).resolves.toBe('unavailable');
    expect(await patientVaultExists()).toBe(false);

    await createPatientVault({ allowUnencrypted: true });
    lockPatientVault();
    await expect(saveDraftTranscript('conv-1', ['текст'])).resolves.toBe('unavailable');
    await expect(readConversationTranscript('conv-1')).resolves.toEqual({ status: 'locked' });
    expect(isPatientVaultUnlocked()).toBe(false);
    expect(fakeDatabase.stores.get('blobs')?.size ?? 0).toBe(0);
  });

  it('fully deletes the vault and device key', async () => {
    await createPatientVault({ allowUnencrypted: true });
    await deletePatientVault();
    expect(isPatientVaultUnlocked()).toBe(false);
    expect(await patientVaultExists()).toBe(false);
    expect(nativeBridge.deleteKey).toHaveBeenCalled();
  });
});

describe('browser device-key vault', () => {
  let fakeDatabase: FakeVaultDatabase;

  const storedVault = (): { mode?: string; key?: unknown; snapshot?: unknown } =>
    fakeDatabase.stores.get('vault')?.get('current') as {
      mode?: string;
      key?: unknown;
      snapshot?: unknown;
    };
  const storedBlobRecord = (id: string): { storage?: string; patientId?: string } =>
    fakeDatabase.stores.get('blobs')?.get(id) as { storage?: string; patientId?: string };

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

  it('keeps a non-extractable key beside ciphertext and round-trips snapshot and files', async () => {
    await createPatientVault();
    await writePatientVault(patientSnapshotWithEvent('patient-secret', 'event-1'));
    await addPatientBlob({
      id: 'blob-1',
      patientId: 'patient-secret',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('жалобы пациента'),
    });

    const vault = storedVault();
    expect(vault.mode).toBe('browser-device-key');
    const key = vault.key as CryptoKey;
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    expect(JSON.stringify(vault.snapshot)).toContain('ciphertext');
    expect(JSON.stringify(vault.snapshot)).not.toContain('patient-secret');
    expect(JSON.stringify(storedBlobRecord('blob-1'))).not.toContain('жалобы');
    expect(storedBlobRecord('blob-1').storage).toBe('encrypted');

    // Locking and opening again needs nothing from the user: the stored key opens it.
    lockPatientVault();
    expect(isPatientVaultUnlocked()).toBe(false);
    await expect(readPatientVault()).rejects.toMatchObject({ code: 'locked' });
    expect((await unlockPatientVault()).profiles[0]?.id).toBe('patient-secret');
    const blob = await readPatientBlob('blob-1');
    expect(new TextDecoder().decode(blob?.bytes)).toBe('жалобы пациента');
  });

  it('is what a phone without a usable keychain gets', async () => {
    nativeBridge.native = true;
    nativeBridge.available = false;
    await expect(createPatientVault()).resolves.toBe('browser-device-key');
    expect(nativeBridge.wrapKey).not.toHaveBeenCalled();
  });

  it('refuses to open with a swapped key or a damaged key record', async () => {
    await createPatientVault();
    await writePatientVault(patientSnapshotWithEvent('patient-1', 'event-1'));
    lockPatientVault();
    const original = storedVault();
    const other = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    fakeDatabase.stores.get('vault')?.set('current', { ...original, key: other });
    await expect(unlockPatientVault()).rejects.toMatchObject({ code: 'integrity' });
    expect(isPatientVaultUnlocked()).toBe(false);

    fakeDatabase.stores.get('vault')?.set('current', { ...original, key: 'not-a-key' });
    await expect(unlockPatientVault()).rejects.toMatchObject({ code: 'integrity' });
  });

  it('exports a readable backup and imports it back under the same key', async () => {
    await createPatientVault();
    await writePatientVault(patientSnapshotWithEvent('patient-1', 'event-1'));
    await addPatientBlob({
      id: 'blob-1',
      patientId: 'patient-1',
      mimeType: 'text/plain',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const backup = await exportPatientVaultBackup();
    expect(backup.blobs[0]?.bytesBase64).toBe('AQID');

    await writePatientVault(emptyPatientVaultSnapshot());
    await importPatientVaultBackup(backup);
    expect((await readPatientVault()).events[0]?.id).toBe('event-1');
    expect(storedBlobRecord('blob-1').storage).toBe('encrypted');
    expect((await readPatientBlob('blob-1'))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  describe('upgrading a plaintext vault in place', () => {
    const seedPlainVault = async (): Promise<void> => {
      await createPatientVault({ allowUnencrypted: true });
      await writePatientVault(patientSnapshotWithEvent('patient-keep', 'event-1'));
      await addPatientBlob({
        id: 'blob-1',
        patientId: 'patient-keep',
        mimeType: 'application/json',
        bytes: new TextEncoder().encode('{"note":"очень личное"}'),
      });
      await addPatientBlob({ id: 'blob-2', mimeType: 'text/plain', bytes: new Uint8Array([9, 8]) });
    };

    it('re-encrypts the snapshot and every file and keeps all of it readable', async () => {
      await seedPlainVault();
      expect(JSON.stringify(storedVault())).toContain('patient-keep');

      await expect(encryptPatientVault()).resolves.toBe('browser-device-key');

      expect(await patientVaultStorageMode()).toBe('browser-device-key');
      expect(isPatientVaultUnlocked()).toBe(true);
      expect(JSON.stringify(storedVault().snapshot)).not.toContain('patient-keep');
      expect(JSON.stringify(storedBlobRecord('blob-1'))).not.toContain('очень личное');
      expect(storedBlobRecord('blob-1').storage).toBe('encrypted');
      expect(storedBlobRecord('blob-2').storage).toBe('encrypted');
      expect(storedBlobRecord('blob-1').patientId).toBe('patient-keep');

      lockPatientVault();
      const snapshot = await unlockPatientVault();
      expect(snapshot.profiles.map((profile) => profile.id)).toEqual(['patient-keep']);
      expect(snapshot.events.map((event) => event.id)).toEqual(['event-1']);
      expect(new TextDecoder().decode((await readPatientBlob('blob-1'))?.bytes)).toBe(
        '{"note":"очень личное"}',
      );
      expect((await readPatientBlob('blob-2'))?.bytes).toEqual(new Uint8Array([9, 8]));
    });

    it('leaves the plaintext vault untouched when the write fails', async () => {
      await seedPlainVault();
      fakeDatabase.failNextReadwrite = true;

      await expect(encryptPatientVault()).rejects.toBeInstanceOf(PatientVaultError);

      expect(await patientVaultStorageMode()).toBe('unencrypted');
      expect(storedBlobRecord('blob-1').storage).toBe('plaintext');
      lockPatientVault();
      expect((await unlockPatientVault()).profiles[0]?.id).toBe('patient-keep');
      expect((await readPatientBlob('blob-2'))?.bytes).toEqual(new Uint8Array([9, 8]));
    });

    it('does not lose a file that is added while the vault is being encrypted', async () => {
      await seedPlainVault();
      const upgrade = encryptPatientVault();
      const late = addPatientBlob({
        id: 'blob-late',
        mimeType: 'text/plain',
        bytes: new Uint8Array([7]),
      });
      await Promise.all([upgrade, late]);

      expect(storedBlobRecord('blob-late').storage).toBe('encrypted');
      expect((await readPatientBlob('blob-late'))?.bytes).toEqual(new Uint8Array([7]));
      expect((await readPatientBlob('blob-1'))?.mimeType).toBe('application/json');
    });

    it('only opens a vault that is already encrypted', async () => {
      await createPatientVault();
      lockPatientVault();
      await expect(encryptPatientVault()).resolves.toBe('browser-device-key');
      expect(isPatientVaultUnlocked()).toBe(true);
    });
  });

  describe('the recording window offer', () => {
    it('creates the vault on a tap and then saves the pending text encrypted', async () => {
      const lines = ['У пациента болит голова третий день'];
      await expect(vaultOffer()).resolves.toBe('create');
      await expect(saveDraftTranscript('conv-1', lines)).resolves.toBe('unavailable');
      expect(await patientVaultExists()).toBe(false);

      await enableEncryptedVault();

      expect(await patientVaultStorageMode()).toBe('browser-device-key');
      await expect(vaultOffer()).resolves.toBeUndefined();
      await expect(saveDraftTranscript('conv-1', lines)).resolves.toBe('saved');
      const raw = JSON.stringify(storedBlobRecord(transcriptBlobId('conv-1')));
      expect(raw).toContain('"storage":"encrypted"');
      expect(raw).not.toContain('болит');

      // The next session opens the same vault silently.
      lockPatientVault();
      await expect(readConversationTranscript('conv-1')).resolves.toEqual({
        status: 'found',
        lines,
      });
    });

    it('encrypts an existing plaintext vault instead of creating a second one', async () => {
      await createPatientVault({ allowUnencrypted: true });
      await writePatientVault(patientSnapshotWithEvent('patient-keep', 'event-1'));
      lockPatientVault();
      await expect(vaultOffer()).resolves.toBe('encrypt');
      await expect(saveDraftTranscript('conv-1', ['текст'])).resolves.toBe('unavailable');

      await enableEncryptedVault();

      expect(await patientVaultStorageMode()).toBe('browser-device-key');
      await expect(saveDraftTranscript('conv-1', ['текст'])).resolves.toBe('saved');
      expect((await readPatientVault()).profiles[0]?.id).toBe('patient-keep');
    });

    it('opens an encrypted vault that is merely locked, and is safe to repeat', async () => {
      await createPatientVault();
      lockPatientVault();
      await Promise.all([enableEncryptedVault(), enableEncryptedVault()]);
      expect(isPatientVaultUnlocked()).toBe(true);
      expect(await patientVaultStorageMode()).toBe('browser-device-key');
    });
  });
});
