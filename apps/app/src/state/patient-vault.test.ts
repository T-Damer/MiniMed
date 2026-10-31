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
  createDiagnosisSaver,
  createFormDataSaver,
  DIAGNOSIS_WRITE_AHEAD_KEY,
  FORM_DATA_WRITE_AHEAD_KEY,
  readDiagnosisDraft,
  readFormDraft,
  recoverPatientDrafts,
} from '@/features/notes/patient-draft-savers';
import { profileToDraft } from '@/features/notes/patient-form-data';
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
  openPatientVaultText,
  PatientVaultError,
  patientVaultDisplayState,
  patientVaultExists,
  patientVaultStorageMode,
  readPatientBlob,
  readPatientVault,
  sealPatientVaultText,
  unlockPatientVault,
  updatePatientVault,
  writePatientVault,
} from '@/state/patient-vault';
import {
  createVisitNoteSaver,
  recoverVisitNotes,
  saveVisitNote,
  VISIT_NOTE_WRITE_AHEAD_KEY,
} from '@/state/patient-visit-note';
import coreClinical from '../../../../content/tool-modules/core-clinical.json';

/**
 * A stand-in for the Android plugin that keeps the real contract: a wrapped key opens only with
 * the protection it was made with, an auth-bound key needs a fingerprint / PIN check that stays
 * valid for a window, and the device key survives until `retireLegacyKey`.
 */
const nativeBridge = vi.hoisted(() => {
  const marker = { device: 1, auth: 2 } as const;
  const state = {
    deviceKeyAlive: false,
    authKeyAlive: false,
    windowOpen: false,
    prompts: 0,
    prompt: 'ok' as 'ok' | 'cancel' | 'failed',
    /** Auth-bound unwraps that still succeed before one fails (a blob that cannot be opened). */
    authUnwrapsLeft: Number.POSITIVE_INFINITY,
  };
  const base64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const reject = (code: string): never => {
    throw Object.assign(new Error(`native ${code}`), { code });
  };
  const authenticate = (): void => {
    if (state.windowOpen) return;
    state.prompts += 1;
    if (state.prompt === 'cancel') reject('AUTH_CANCELLED');
    if (state.prompt === 'failed') reject('AUTH_FAILED');
    state.windowOpen = true;
  };
  return {
    native: false,
    available: false,
    authAvailable: false,
    state,
    deleteKey: vi.fn(async () => {
      state.deviceKeyAlive = false;
      state.authKeyAlive = false;
    }),
    wrapKey: vi.fn(async (key: Uint8Array, protection: 'device' | 'auth' = 'device') => {
      if (protection === 'auth') {
        authenticate();
        state.authKeyAlive = true;
      } else {
        state.deviceKeyAlive = true;
      }
      const ciphertext = new Uint8Array(48).fill(marker[protection]);
      ciphertext.set(key.slice(), 0);
      return {
        ivBase64: base64(new Uint8Array(12).fill(marker[protection])),
        ciphertextBase64: base64(ciphertext),
      };
    }),
    unwrapKey: vi.fn(
      async (
        wrapped: { readonly ciphertextBase64: string },
        protection: 'device' | 'auth' = 'device',
      ) => {
        if (protection === 'auth') {
          if (!state.authKeyAlive) reject('KEY_INVALIDATED');
          authenticate();
          if (state.authUnwrapsLeft <= 0) throw new Error('stored blob does not open');
          state.authUnwrapsLeft -= 1;
        } else if (!state.deviceKeyAlive) {
          throw new Error('Vault key is missing');
        }
        const ciphertext = Uint8Array.from(atob(wrapped.ciphertextBase64), (c) => c.charCodeAt(0));
        if (ciphertext[47] !== marker[protection]) throw new Error('AEADBadTagException');
        return ciphertext.slice(0, 32);
      },
    ),
    retire: vi.fn(async () => {
      if (!state.authKeyAlive) return false;
      state.deviceKeyAlive = false;
      return true;
    }),
  };
});

vi.mock('@/state/patient-vault-native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/state/patient-vault-native')>()),
  deletePatientVaultNativeKey: nativeBridge.deleteKey,
  isNativePatientVaultAuthAvailable: async () => nativeBridge.native && nativeBridge.authAvailable,
  isNativePatientVaultKeychainAvailable: async () => nativeBridge.available,
  isPatientVaultNativePlatform: () => nativeBridge.native,
  retireLegacyPatientVaultKey: nativeBridge.retire,
  unwrapPatientVaultKey: nativeBridge.unwrapKey,
  wrapPatientVaultKey: nativeBridge.wrapKey,
}));

function resetNativeBridge(): void {
  nativeBridge.native = false;
  nativeBridge.available = false;
  nativeBridge.authAvailable = false;
  Object.assign(nativeBridge.state, {
    deviceKeyAlive: false,
    authKeyAlive: false,
    windowOpen: false,
    prompts: 0,
    prompt: 'ok',
    authUnwrapsLeft: Number.POSITIVE_INFINITY,
  });
}

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
    resetNativeBridge();
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
    resetNativeBridge();
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

describe('visit note autosave', () => {
  let fakeDatabase: FakeVaultDatabase;
  let storage: Map<string, string>;

  const ahead = (): string => storage.get(VISIT_NOTE_WRITE_AHEAD_KEY) ?? '';
  const until = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
  };
  const saverFor = (patientId: string, delayMs = 20) =>
    createVisitNoteSaver({
      patientId,
      episodeId: () => undefined,
      onSnapshot: () => undefined,
      onError: (cause) => {
        throw cause;
      },
      delayMs,
      newVisitDelayMs: delayMs,
    });

  beforeEach(() => {
    fakeDatabase = installIndexedDbDouble();
    storage = new Map();
    const target = new EventTarget();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
    vi.stubGlobal('document', new EventTarget());
    resetNativeBridge();
    lockPatientVault();
  });

  afterEach(() => {
    lockPatientVault();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the write-ahead copy sealed, then drops it once the vault holds the text', async () => {
    await createPatientVault();
    const { patientId } = await createPatientInVault({ displayName: 'Пациент' });
    const saver = saverFor(patientId);

    saver.edit('Кашель третий день');
    await until(() => ahead() !== '');
    expect(ahead()).toContain('ciphertext');
    expect(ahead()).not.toContain('Кашель');

    await expect(saver.flush()).resolves.toBe(true);
    expect(ahead()).toBe('');
    const stored = JSON.stringify(fakeDatabase.stores.get('vault')?.get('current'));
    expect(stored).not.toContain('Кашель');
    expect((await readPatientVault()).episodes).toMatchObject([
      { text: 'Кашель третий день', status: 'open' },
    ]);
    saver.dispose();
  });

  it('applies the newest of several quick edits, in order', async () => {
    await createPatientVault();
    const { patientId } = await createPatientInVault({ displayName: 'Пациент' });
    const saver = saverFor(patientId, 5);
    saver.edit('а');
    saver.edit('аб');
    await new Promise((resolve) => setTimeout(resolve, 8));
    saver.edit('абв');
    await expect(saver.flush()).resolves.toBe(true);
    const { episodes } = await readPatientVault();
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.text).toBe('абв');
    saver.dispose();
  });

  it('recovers a note typed just before a reload from the write-ahead copy', async () => {
    await createPatientVault();
    const { patientId } = await createPatientInVault({ displayName: 'Пациент' });
    // The durable save never starts: the page is reloaded inside the debounce window.
    const saver = saverFor(patientId, 60_000);
    saver.edit('Текст до перезагрузки');
    await until(() => ahead() !== '');
    saver.dispose();
    lockPatientVault();
    expect((await unlockPatientVault()).episodes).toHaveLength(0);

    const recovered = await recoverVisitNotes();
    expect(recovered?.episodes).toMatchObject([{ text: 'Текст до перезагрузки', status: 'open' }]);
    expect(ahead()).toBe('');
    await expect(recoverVisitNotes()).resolves.toBeUndefined();
    expect((await readPatientVault()).episodes).toHaveLength(1);
  });

  it('leaves the copies of a card that is being edited to its own autosave', async () => {
    await createPatientVault();
    const { patientId } = await createPatientInVault({ displayName: 'Пациент' });
    const saver = saverFor(patientId, 60_000);
    saver.edit('Ещё печатается');
    await until(() => ahead() !== '');
    await expect(recoverVisitNotes()).resolves.toBeUndefined();
    expect(ahead()).not.toBe('');
    expect((await readPatientVault()).episodes).toHaveLength(0);
    saver.dispose();
    // Once the card is closed without saving, the copy is recovered like any other.
    expect((await recoverVisitNotes())?.episodes).toMatchObject([{ text: 'Ещё печатается' }]);
  });

  it('writes a plain copy only when the vault itself is plain', async () => {
    await createPatientVault({ allowUnencrypted: true });
    const { patientId } = await createPatientInVault({ displayName: 'Пациент' });
    const saver = saverFor(patientId, 60_000);
    saver.edit('Открытый текст');
    await until(() => ahead() !== '');
    expect(ahead()).toContain('Открытый текст');
    saver.dispose();
  });

  it('keeps one open visit when «Создать осмотр» runs twice at once', async () => {
    await createPatientVault();
    const { patientId } = await createPatientInVault({ displayName: 'Пациент' });
    await Promise.all([
      saveVisitNote({ patientId, text: 'Один', create: true }),
      saveVisitNote({ patientId, text: 'Один', create: true }),
    ]);
    const { episodes } = await readPatientVault();
    expect(episodes.filter((episode) => episode.status === 'open')).toHaveLength(1);
    expect(episodes[0]?.text).toBe('Один');
  });

  it('seals and opens vault text, and refuses a copy sealed for another purpose', async () => {
    await createPatientVault();
    const sealed = await sealPatientVaultText('visit-note-ahead', 'a|new', 'Секрет');
    expect(JSON.stringify(sealed)).not.toContain('Секрет');
    await expect(openPatientVaultText('visit-note-ahead', 'a|new', sealed)).resolves.toBe('Секрет');
    await expect(openPatientVaultText('visit-note-ahead', 'b|new', sealed)).rejects.toMatchObject({
      code: 'integrity',
    });
    lockPatientVault();
    await expect(sealPatientVaultText('visit-note-ahead', 'a|new', 'x')).rejects.toMatchObject({
      code: 'locked',
    });
  });
});

describe('form data and diagnosis drafts', () => {
  let storage: Map<string, string>;

  const stored = (key: string): string => storage.get(key) ?? '';
  const until = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
  };
  const formSaver = (patientId: string, delayMs = 20) =>
    createFormDataSaver({
      patientId,
      delayMs,
      onSnapshot: () => undefined,
      onValidation: () => undefined,
      onError: (cause) => {
        throw cause;
      },
    });
  const diagnosisSaver = (patientId: string, episodeId: string, delayMs = 20) =>
    createDiagnosisSaver({
      patientId,
      episodeId: () => episodeId,
      delayMs,
      onSnapshot: () => undefined,
      onValidation: () => undefined,
      onError: (cause) => {
        throw cause;
      },
    });

  beforeEach(() => {
    installIndexedDbDouble();
    storage = new Map();
    const target = new EventTarget();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
    vi.stubGlobal('document', new EventTarget());
    resetNativeBridge();
    lockPatientVault();
  });

  afterEach(() => {
    lockPatientVault();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves the valid fields, keeps an invalid SNILS as a sealed draft and clears it once fixed', async () => {
    await createPatientVault();
    const { patientId, snapshot } = await createPatientInVault({ displayName: 'Пациент' });
    const profile = snapshot.profiles.find((candidate) => candidate.id === patientId);
    if (!profile) throw new Error('profile missing');
    const typed = { ...profileToDraft(profile), workplace: 'Лицей 5', snils: '123-4' };
    const saver = formSaver(patientId);

    saver.edit(typed);
    await until(() => stored(FORM_DATA_WRITE_AHEAD_KEY) !== '');
    expect(stored(FORM_DATA_WRITE_AHEAD_KEY)).toContain('ciphertext');
    expect(stored(FORM_DATA_WRITE_AHEAD_KEY)).not.toContain('Лицей');
    await expect(saver.flush()).resolves.toBe(true);

    const [saved] = (await readPatientVault()).profiles;
    expect(saved).toMatchObject({ workplace: 'Лицей 5' });
    expect(saved).not.toHaveProperty('snils');
    // The part the vault could not take stays, and comes back as the draft after a reload.
    await until(() => stored(FORM_DATA_WRITE_AHEAD_KEY) !== '');
    await expect(readFormDraft(patientId)).resolves.toMatchObject({ snils: '123-4' });

    saver.edit({ ...typed, snils: '12345678901' });
    await expect(saver.flush()).resolves.toBe(true);
    expect(stored(FORM_DATA_WRITE_AHEAD_KEY)).toBe('');
    expect((await readPatientVault()).profiles[0]).toMatchObject({ snils: '123-456-789 01' });
    await expect(readFormDraft(patientId)).resolves.toBeUndefined();
    saver.dispose();
  });

  it('recovers form data typed just before a reload, and keeps only what is still invalid', async () => {
    await createPatientVault();
    const { patientId, snapshot } = await createPatientInVault({ displayName: 'Пациент' });
    const profile = snapshot.profiles.find((candidate) => candidate.id === patientId);
    if (!profile) throw new Error('profile missing');
    // The durable save never starts: the page is reloaded inside the debounce window.
    const saver = formSaver(patientId, 60_000);
    saver.edit({ ...profileToDraft(profile), workplace: 'Поликлиника 3', snils: '12' });
    await until(() => stored(FORM_DATA_WRITE_AHEAD_KEY) !== '');
    saver.dispose();
    lockPatientVault();
    expect((await unlockPatientVault()).profiles[0]).not.toHaveProperty('workplace');

    const recovered = await recoverPatientDrafts();
    expect(recovered?.profiles[0]).toMatchObject({ workplace: 'Поликлиника 3' });
    expect(recovered?.profiles[0]).not.toHaveProperty('snils');
    // The invalid SNILS is still a draft; a second open changes nothing in the vault.
    expect(stored(FORM_DATA_WRITE_AHEAD_KEY)).not.toBe('');
    const updatedAt = recovered?.profiles[0]?.updatedAt;
    const again = await recoverPatientDrafts();
    expect(again?.profiles[0]?.updatedAt).toBe(updatedAt);
    await expect(readFormDraft(patientId)).resolves.toMatchObject({
      snils: '12',
      workplace: 'Поликлиника 3',
    });
  });

  it('saves a visit diagnosis, keeps a bad ICD-10 code as a draft per visit and recovers after a reload', async () => {
    await createPatientVault();
    const { patientId } = await createPatientInVault({ displayName: 'Пациент' });
    const snapshot = await saveVisitNote({ patientId, text: 'Осмотр', create: true });
    const episodeId = snapshot.episodes[0]?.id;
    if (!episodeId) throw new Error('visit missing');
    const saver = diagnosisSaver(patientId, episodeId);

    saver.edit({ text: 'Бронхиальная астма', icd10: 'J45.0' });
    await expect(saver.flush()).resolves.toBe(true);
    expect((await readPatientVault()).episodes[0]?.diagnosis).toEqual({
      text: 'Бронхиальная астма',
      icd10: 'J45.0',
    });
    expect(stored(DIAGNOSIS_WRITE_AHEAD_KEY)).toBe('');

    saver.edit({ text: 'Бронхит', icd10: 'J4' });
    await expect(saver.flush()).resolves.toBe(true);
    // The stored diagnosis is untouched; the typed pair waits as a sealed draft.
    expect((await readPatientVault()).episodes[0]?.diagnosis).toEqual({
      text: 'Бронхиальная астма',
      icd10: 'J45.0',
    });
    await until(() => stored(DIAGNOSIS_WRITE_AHEAD_KEY) !== '');
    expect(stored(DIAGNOSIS_WRITE_AHEAD_KEY)).not.toContain('Бронхит');
    await expect(readDiagnosisDraft(patientId, episodeId)).resolves.toEqual({
      text: 'Бронхит',
      icd10: 'J4',
    });
    saver.dispose();

    // A reload and a new open: the code is fixed in a new session that never reached its save.
    const next = diagnosisSaver(patientId, episodeId, 60_000);
    next.edit({ text: 'Бронхит', icd10: 'J20.9' });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if ((await readDiagnosisDraft(patientId, episodeId))?.icd10 === 'J20.9') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    next.dispose();
    lockPatientVault();
    await unlockPatientVault();
    const recovered = await recoverPatientDrafts();
    expect(recovered?.episodes[0]?.diagnosis).toEqual({ text: 'Бронхит', icd10: 'J20.9' });
    expect(stored(DIAGNOSIS_WRITE_AHEAD_KEY)).toBe('');
  });
});

describe('native vault with a fingerprint / PIN key', () => {
  let fakeDatabase: FakeVaultDatabase;

  interface WrappedRecord {
    protection?: string;
    ivBase64: string;
    ciphertextBase64: string;
  }
  const storedWrapped = (): WrappedRecord => {
    const record = fakeDatabase.stores.get('vault')?.get('current') as
      | { wrappedKey: WrappedRecord }
      | undefined;
    if (!record) throw new Error('no stored vault');
    return record.wrappedKey;
  };

  /** A vault made by the build before the fingerprint unlock: device key, no `protection` field. */
  const createLegacyVault = async (): Promise<void> => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    nativeBridge.authAvailable = false;
    await createPatientVault();
    await writePatientVault(patientSnapshotWithEvent('patient-legacy', 'event-1'));
    const record = fakeDatabase.stores.get('vault')?.get('current') as {
      wrappedKey: { protection?: string };
    };
    delete record.wrappedKey.protection;
    lockPatientVault();
    nativeBridge.authAvailable = true;
    nativeBridge.state.prompts = 0;
    nativeBridge.wrapKey.mockClear();
    nativeBridge.unwrapKey.mockClear();
  };

  beforeEach(() => {
    fakeDatabase = installIndexedDbDouble();
    resetNativeBridge();
    lockPatientVault();
  });

  afterEach(() => {
    lockPatientVault();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a new vault behind the auth-bound key and asks once', async () => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    nativeBridge.authAvailable = true;
    await createPatientVault();

    expect(storedWrapped().protection).toBe('auth');
    expect(nativeBridge.state.prompts).toBe(1);
    expect(nativeBridge.state.deviceKeyAlive).toBe(false);

    // The window is still open: the next unlock needs no second check.
    lockPatientVault();
    await unlockPatientVault();
    expect(nativeBridge.state.prompts).toBe(1);

    // After the window the prompt returns.
    lockPatientVault();
    nativeBridge.state.windowOpen = false;
    await unlockPatientVault();
    expect(nativeBridge.state.prompts).toBe(2);
  });

  it('moves a legacy vault to the auth-bound key, then retires the device key', async () => {
    await createLegacyVault();
    expect(nativeBridge.state.deviceKeyAlive).toBe(true);

    const snapshot = await unlockPatientVault();

    expect(snapshot.profiles[0]?.id).toBe('patient-legacy');
    expect(storedWrapped().protection).toBe('auth');
    expect(nativeBridge.state.prompts).toBe(1);
    expect(nativeBridge.retire).toHaveBeenCalledOnce();
    expect(nativeBridge.state.deviceKeyAlive).toBe(false);

    // Everything still opens through the new key alone, snapshot and later writes included.
    await writePatientVault(patientSnapshotWithEvent('patient-after', 'event-2'));
    lockPatientVault();
    nativeBridge.state.windowOpen = false;
    expect((await unlockPatientVault()).profiles[0]?.id).toBe('patient-after');
  });

  it('a cancelled prompt keeps a legacy vault locked and untouched, and it opens on retry', async () => {
    await createLegacyVault();
    const before = JSON.stringify(storedWrapped());
    nativeBridge.state.prompt = 'cancel';

    await expect(unlockPatientVault()).rejects.toMatchObject({
      code: 'auth-required',
      message: expect.stringContaining('заблокировано'),
    });

    expect(isPatientVaultUnlocked()).toBe(false);
    expect(JSON.stringify(storedWrapped())).toBe(before);
    expect(nativeBridge.state.deviceKeyAlive).toBe(true);
    expect(nativeBridge.retire).not.toHaveBeenCalled();
    expect(nativeBridge.deleteKey).not.toHaveBeenCalled();
    expect(await patientVaultExists()).toBe(true);

    nativeBridge.state.prompt = 'ok';
    expect((await unlockPatientVault()).profiles[0]?.id).toBe('patient-legacy');
    expect(storedWrapped().protection).toBe('auth');
  });

  it('a cancelled prompt on an auth-bound vault leaves it locked, and it opens on retry', async () => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    nativeBridge.authAvailable = true;
    await createPatientVault();
    await writePatientVault(patientSnapshotWithEvent('patient-auth', 'event-1'));
    lockPatientVault();
    nativeBridge.state.windowOpen = false;
    nativeBridge.state.prompt = 'cancel';

    await expect(unlockPatientVault()).rejects.toMatchObject({ code: 'auth-required' });
    expect(isPatientVaultUnlocked()).toBe(false);
    await expect(readPatientVault()).rejects.toMatchObject({ code: 'locked' });

    nativeBridge.state.prompt = 'ok';
    expect((await unlockPatientVault()).profiles[0]?.id).toBe('patient-auth');
  });

  it('keeps the old blob and the old key when the new blob cannot be stored', async () => {
    await createLegacyVault();
    const before = JSON.stringify(storedWrapped());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The migration write is the only readwrite transaction an unlock makes.
    fakeDatabase.failNextReadwrite = true;

    const snapshot = await unlockPatientVault();

    expect(snapshot.profiles[0]?.id).toBe('patient-legacy');
    expect(JSON.stringify(storedWrapped())).toBe(before);
    expect(nativeBridge.state.deviceKeyAlive).toBe(true);
    expect(nativeBridge.retire).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();

    // The next unlock finishes the move.
    lockPatientVault();
    await unlockPatientVault();
    expect(storedWrapped().protection).toBe('auth');
    expect(nativeBridge.state.deviceKeyAlive).toBe(false);
  });

  it('puts the old blob back when the stored new blob does not verify', async () => {
    await createLegacyVault();
    const before = JSON.stringify(storedWrapped());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The check right after the wrap passes; the check of the stored copy fails.
    nativeBridge.state.authUnwrapsLeft = 1;

    const snapshot = await unlockPatientVault();

    expect(snapshot.profiles[0]?.id).toBe('patient-legacy');
    expect(JSON.stringify(storedWrapped())).toBe(before);
    expect(nativeBridge.state.deviceKeyAlive).toBe(true);
    expect(nativeBridge.retire).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('keeps the device key on a phone without a secure lock screen and says so', async () => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    nativeBridge.authAvailable = false;
    await createPatientVault();

    expect(storedWrapped().protection).toBe('device');
    expect(nativeBridge.state.prompts).toBe(0);
    expect(await patientVaultDisplayState()).toBe('native-keychain-no-lock');

    lockPatientVault();
    await unlockPatientVault();
    expect(nativeBridge.state.prompts).toBe(0);
    expect(nativeBridge.retire).not.toHaveBeenCalled();
    expect(storedWrapped().protection).toBe('device');
  });

  it('reads as an ordinary protected vault while a legacy one waits for its first unlock', async () => {
    await createLegacyVault();
    expect(await patientVaultDisplayState()).toBe('native-keychain');
  });

  it('reports a removed key without deleting or resetting anything', async () => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    nativeBridge.authAvailable = true;
    await createPatientVault();
    await writePatientVault(patientSnapshotWithEvent('patient-kept', 'event-1'));
    lockPatientVault();
    // Android drops auth-bound keys when the lock screen is removed.
    nativeBridge.state.authKeyAlive = false;
    const before = JSON.stringify(fakeDatabase.stores.get('vault')?.get('current'));

    await expect(unlockPatientVault()).rejects.toMatchObject({
      code: 'key-invalidated',
      message: expect.stringContaining('копии'),
    });

    expect(JSON.stringify(fakeDatabase.stores.get('vault')?.get('current'))).toBe(before);
    expect(nativeBridge.deleteKey).not.toHaveBeenCalled();
    expect(await patientVaultExists()).toBe(true);
  });

  it('retires a leftover device key after an auth-bound unlock proved the new blob', async () => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    nativeBridge.authAvailable = true;
    await createPatientVault();
    // An upgrade that stored its blob and then lost the app before retiring the old key.
    nativeBridge.state.deviceKeyAlive = true;
    lockPatientVault();

    await unlockPatientVault();

    expect(nativeBridge.retire).toHaveBeenCalledOnce();
    expect(nativeBridge.state.deviceKeyAlive).toBe(false);
  });

  it('does not create a vault when the very first prompt is cancelled', async () => {
    nativeBridge.native = true;
    nativeBridge.available = true;
    nativeBridge.authAvailable = true;
    nativeBridge.state.prompt = 'cancel';

    await expect(createPatientVault()).rejects.toMatchObject({ code: 'auth-required' });
    expect(await patientVaultExists()).toBe(false);
  });
});
