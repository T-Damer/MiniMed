import {
  emptyPatientVaultSnapshot,
  normalizePatientVaultSnapshot,
  PATIENT_DOMAIN_SCHEMA_VERSION,
  type PatientVaultSnapshot,
  removePatientFromSnapshot,
  selectPatientFromSnapshot,
} from '@/state/patient-domain';
import {
  deletePatientVaultNativeKey,
  isNativePatientVaultKeychainAvailable,
  isPatientVaultNativePlatform,
  unwrapPatientVaultKey,
  wrapPatientVaultKey,
} from '@/state/patient-vault-native';

const DATABASE_NAME = 'minimed-patient-vault-v3';
const LEGACY_DATABASE_NAMES = ['minimed-patient-vault-v2'] as const;
const DATABASE_VERSION = 1;
const VAULT_STORE = 'vault';
const BLOB_STORE = 'blobs';
const VAULT_KEY = 'current';
const IV_BYTES = 12;
const AES_KEY_BYTES = 32;

export const PATIENT_VAULT_SCHEMA_VERSION = 3 as const;
export const PATIENT_VAULT_EVENT = 'minimed:patient-vault-changed';
export const PATIENT_VAULT_LOCK_EVENT = 'minimed:patient-vault-locked';
export const PATIENT_VAULT_UI_CLEARED_EVENT = 'minimed:patient-vault-ui-cleared';

export type PatientVaultStorageMode = 'native-keychain' | 'unencrypted';

interface NativeWrappedKey {
  readonly ivBase64: string;
  readonly ciphertextBase64: string;
}

interface EncryptedRecord {
  readonly type: 'patient-snapshot';
  readonly id: 'current';
  readonly version: typeof PATIENT_VAULT_SCHEMA_VERSION;
  readonly iv: string;
  readonly aad: string;
  readonly ciphertext: string;
}

interface PlainRecord {
  readonly type: 'patient-snapshot';
  readonly id: 'current';
  readonly version: typeof PATIENT_VAULT_SCHEMA_VERSION;
  readonly data: PatientVaultSnapshot;
}

interface NativeStoredVault {
  readonly schemaVersion: typeof PATIENT_VAULT_SCHEMA_VERSION;
  readonly mode: 'native-keychain';
  readonly wrappedKey: NativeWrappedKey;
  readonly snapshot: EncryptedRecord;
}

interface PlainStoredVault {
  readonly schemaVersion: typeof PATIENT_VAULT_SCHEMA_VERSION;
  readonly mode: 'unencrypted';
  readonly snapshot: PlainRecord;
}

type StoredVault = NativeStoredVault | PlainStoredVault;

interface StoredBlobBase {
  readonly type: 'patient-file';
  readonly id: string;
  readonly version: typeof PATIENT_VAULT_SCHEMA_VERSION;
  readonly mimeType: string;
  readonly patientId?: string;
}

interface EncryptedBlob extends StoredBlobBase {
  readonly storage: 'encrypted';
  readonly iv: string;
  readonly aad: string;
  readonly ciphertext: string;
}

interface PlainBlob extends StoredBlobBase {
  readonly storage: 'plaintext';
  readonly bytes: Uint8Array;
}

type StoredBlob = EncryptedBlob | PlainBlob;

export interface PatientVaultBackupBlob {
  readonly id: string;
  readonly mimeType: string;
  readonly patientId?: string;
  readonly bytesBase64: string;
}

/** Portable exports are plaintext because device Keychain keys cannot be exported. */
export interface PatientVaultBackup {
  readonly kind: 'minimed-patient-vault-backup';
  readonly schemaVersion: typeof PATIENT_VAULT_SCHEMA_VERSION;
  readonly snapshot: PatientVaultSnapshot;
  readonly blobs: readonly PatientVaultBackupBlob[];
}

export class PatientVaultError extends Error {
  public constructor(
    message: string,
    public readonly code: 'unavailable' | 'integrity' | 'locked' | 'storage',
  ) {
    super(message);
    this.name = 'PatientVaultError';
  }
}

export class PatientVaultLockedError extends PatientVaultError {
  public constructor() {
    super('Пациентское хранилище заблокировано.', 'locked');
  }
}

type VaultSession =
  | { readonly mode: 'native-keychain'; readonly key: CryptoKey; readonly rawKey: Uint8Array }
  | { readonly mode: 'unencrypted' };

let session: VaultSession | undefined;
let lifecycleCleanup: (() => void) | undefined;
let vaultMutationQueue: Promise<void> = Promise.resolve();
let legacyCleanup: Promise<void> | undefined;

export function withPatientVaultMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = vaultMutationQueue.then(mutation, mutation);
  vaultMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function asStorageError(error: unknown, message: string): PatientVaultError {
  return error instanceof PatientVaultError ? error : new PatientVaultError(message, 'storage');
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new PatientVaultError('Web Crypto недоступен в текущем окружении.', 'unavailable');
  }
  return globalThis.crypto;
}

function requireIndexedDb(): IDBFactory {
  if (!globalThis.indexedDB?.open) {
    throw new PatientVaultError('IndexedDB недоступен в текущем окружении.', 'unavailable');
  }
  return globalThis.indexedDB;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
      throw new Error('malformed base64');
    }
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (bytes.byteLength === 0) throw new Error('empty base64');
    return bytes;
  } catch {
    throw new PatientVaultError('Повреждены данные хранилища.', 'integrity');
  }
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function aad(type: string, id: string, version: number = PATIENT_VAULT_SCHEMA_VERSION): string {
  return `${type}:${id}:v${version}`;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  requireCrypto().getRandomValues(bytes);
  return bytes;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(asStorageError(request.error, 'Ошибка IndexedDB.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(asStorageError(transaction.error, 'Ошибка IndexedDB.'));
    transaction.onabort = () => reject(asStorageError(transaction.error, 'Транзакция отменена.'));
  });
}

function deleteDatabase(name: string): Promise<void> {
  if (!globalThis.indexedDB?.deleteDatabase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(asStorageError(request.error, `Не удалось удалить хранилище ${name}.`));
    request.onblocked = () =>
      reject(new PatientVaultError(`Удаление хранилища ${name} заблокировано.`, 'storage'));
  });
}

async function dropLegacyDatabases(): Promise<void> {
  legacyCleanup ??= Promise.all(LEGACY_DATABASE_NAMES.map(deleteDatabase)).then(() => undefined);
  await legacyCleanup;
}

async function openDatabase(): Promise<IDBDatabase> {
  await dropLegacyDatabases();
  const request = requireIndexedDb().open(DATABASE_NAME, DATABASE_VERSION);
  return new Promise((resolve, reject) => {
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(VAULT_STORE)) database.createObjectStore(VAULT_STORE);
      if (!database.objectStoreNames.contains(BLOB_STORE)) {
        database.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(asStorageError(request.error, 'Не удалось открыть пациентское хранилище.'));
  });
}

async function generateDataKey(): Promise<{
  readonly key: CryptoKey;
  readonly rawKey: Uint8Array;
}> {
  const rawKey = randomBytes(AES_KEY_BYTES);
  const key = await requireCrypto().subtle.importKey(
    'raw',
    arrayBuffer(rawKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, rawKey };
}

async function importDataKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== AES_KEY_BYTES) {
    throw new PatientVaultError('Keychain вернул ключ неверной длины.', 'integrity');
  }
  return requireCrypto().subtle.importKey('raw', arrayBuffer(rawKey), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptBytes(
  key: CryptoKey,
  bytes: Uint8Array,
  type: string,
  id: string,
): Promise<{ readonly iv: string; readonly aad: string; readonly ciphertext: string }> {
  const iv = randomBytes(IV_BYTES);
  const associatedData = aad(type, id);
  const ciphertext = await requireCrypto().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: arrayBuffer(iv),
      additionalData: arrayBuffer(utf8(associatedData)),
      tagLength: 128,
    },
    key,
    arrayBuffer(bytes),
  );
  return { iv: bytesToBase64(iv), aad: associatedData, ciphertext: bytesToBase64(ciphertext) };
}

async function decryptBytes(
  record: {
    readonly iv: string;
    readonly aad: string;
    readonly ciphertext: string;
    readonly type: string;
    readonly id: string;
    readonly version: number;
  },
  key: CryptoKey,
): Promise<Uint8Array> {
  if (record.aad !== aad(record.type, record.id, record.version)) {
    throw new PatientVaultError('Неверная целостность записи.', 'integrity');
  }
  try {
    const iv = base64ToBytes(record.iv);
    const ciphertext = base64ToBytes(record.ciphertext);
    if (iv.byteLength !== IV_BYTES || ciphertext.byteLength < 16) throw new Error('bad record');
    const plain = await requireCrypto().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: arrayBuffer(iv),
        additionalData: arrayBuffer(utf8(record.aad)),
        tagLength: 128,
      },
      key,
      arrayBuffer(ciphertext),
    );
    return new Uint8Array(plain);
  } catch {
    throw new PatientVaultError('Не удалось расшифровать пациентские данные.', 'integrity');
  }
}

function assertEncryptedRecord(value: unknown): asserts value is EncryptedRecord {
  const record = value as Partial<EncryptedRecord> | undefined;
  if (
    record?.type !== 'patient-snapshot' ||
    record.id !== 'current' ||
    record.version !== PATIENT_VAULT_SCHEMA_VERSION ||
    typeof record.iv !== 'string' ||
    typeof record.aad !== 'string' ||
    typeof record.ciphertext !== 'string' ||
    base64ToBytes(record.iv).byteLength !== IV_BYTES ||
    base64ToBytes(record.ciphertext).byteLength < 16 ||
    record.aad !== aad(record.type, record.id, record.version)
  ) {
    throw new PatientVaultError('Повреждён снимок пациентского хранилища.', 'integrity');
  }
}

function assertWrappedKey(value: unknown): asserts value is NativeWrappedKey {
  const wrapped = value as Partial<NativeWrappedKey> | undefined;
  if (
    !wrapped ||
    typeof wrapped.ivBase64 !== 'string' ||
    typeof wrapped.ciphertextBase64 !== 'string' ||
    base64ToBytes(wrapped.ivBase64).byteLength !== IV_BYTES ||
    base64ToBytes(wrapped.ciphertextBase64).byteLength !== AES_KEY_BYTES + 16
  ) {
    throw new PatientVaultError('Повреждена Keychain-обёртка хранилища.', 'integrity');
  }
}

function assertStoredVault(value: unknown): asserts value is StoredVault {
  const stored = value as Partial<StoredVault> | undefined;
  if (!stored || stored.schemaVersion !== PATIENT_VAULT_SCHEMA_VERSION) {
    throw new PatientVaultError('Повреждено пациентское хранилище.', 'integrity');
  }
  if (stored.mode === 'native-keychain') {
    assertWrappedKey(stored.wrappedKey);
    assertEncryptedRecord(stored.snapshot);
    return;
  }
  if (stored.mode === 'unencrypted') {
    const record = stored.snapshot as Partial<PlainRecord> | undefined;
    if (
      record?.type !== 'patient-snapshot' ||
      record.id !== 'current' ||
      record.version !== PATIENT_VAULT_SCHEMA_VERSION
    ) {
      throw new PatientVaultError('Повреждён снимок пациентского хранилища.', 'integrity');
    }
    normalizePatientVaultSnapshot(record.data);
    return;
  }
  throw new PatientVaultError('Неизвестный режим пациентского хранилища.', 'integrity');
}

function assertStoredBlob(value: unknown): asserts value is StoredBlob {
  const blob = value as Partial<StoredBlob> | undefined;
  if (
    blob?.type !== 'patient-file' ||
    typeof blob.id !== 'string' ||
    !blob.id ||
    blob.version !== PATIENT_VAULT_SCHEMA_VERSION ||
    typeof blob.mimeType !== 'string' ||
    (blob.patientId !== undefined && typeof blob.patientId !== 'string')
  ) {
    throw new PatientVaultError('Повреждён файл пациента.', 'integrity');
  }
  if (blob.storage === 'plaintext') {
    if (!(blob.bytes instanceof Uint8Array)) {
      throw new PatientVaultError('Повреждён файл пациента.', 'integrity');
    }
    return;
  }
  if (
    blob.storage !== 'encrypted' ||
    typeof blob.iv !== 'string' ||
    typeof blob.aad !== 'string' ||
    typeof blob.ciphertext !== 'string' ||
    base64ToBytes(blob.iv).byteLength !== IV_BYTES ||
    base64ToBytes(blob.ciphertext).byteLength < 16 ||
    blob.aad !== aad(blob.type, blob.id, blob.version)
  ) {
    throw new PatientVaultError('Повреждён файл пациента.', 'integrity');
  }
}

function parseBackup(value: unknown): PatientVaultBackup {
  const backup = value as Partial<PatientVaultBackup> | undefined;
  if (
    backup?.kind !== 'minimed-patient-vault-backup' ||
    backup.schemaVersion !== PATIENT_VAULT_SCHEMA_VERSION ||
    !Array.isArray(backup.blobs)
  ) {
    throw new PatientVaultError('Неверный файл резервной копии.', 'integrity');
  }
  let snapshot: PatientVaultSnapshot;
  try {
    snapshot = normalizePatientVaultSnapshot(backup.snapshot);
  } catch {
    throw new PatientVaultError('Повреждён снимок резервной копии.', 'integrity');
  }
  const patientIds = new Set(snapshot.profiles.map((profile) => profile.id));
  const blobs = backup.blobs.map((value) => {
    const blob = value as Partial<PatientVaultBackupBlob>;
    if (
      typeof blob.id !== 'string' ||
      !blob.id ||
      typeof blob.mimeType !== 'string' ||
      typeof blob.bytesBase64 !== 'string' ||
      (blob.patientId !== undefined && !patientIds.has(blob.patientId))
    ) {
      throw new PatientVaultError('Повреждён файл резервной копии.', 'integrity');
    }
    base64ToBytes(blob.bytesBase64);
    return blob as PatientVaultBackupBlob;
  });
  return {
    kind: 'minimed-patient-vault-backup',
    schemaVersion: PATIENT_VAULT_SCHEMA_VERSION,
    snapshot,
    blobs,
  };
}

async function readStoredVault(): Promise<StoredVault | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VAULT_STORE, 'readonly');
    const done = transactionDone(transaction);
    const stored = await requestResult(
      transaction.objectStore(VAULT_STORE).get(VAULT_KEY) as IDBRequest<StoredVault | undefined>,
    );
    await done;
    if (stored) assertStoredVault(stored);
    return stored;
  } finally {
    database.close();
  }
}

async function writeStoredVault(stored: StoredVault): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VAULT_STORE, 'readwrite');
    transaction.objectStore(VAULT_STORE).put(stored, VAULT_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function snapshotRecord(
  snapshot: PatientVaultSnapshot,
): Promise<EncryptedRecord | PlainRecord> {
  const normalized = normalizePatientVaultSnapshot(snapshot);
  if (!session) throw new PatientVaultLockedError();
  if (session.mode === 'unencrypted') {
    return {
      type: 'patient-snapshot',
      id: 'current',
      version: PATIENT_VAULT_SCHEMA_VERSION,
      data: normalized,
    };
  }
  return {
    type: 'patient-snapshot',
    id: 'current',
    version: PATIENT_VAULT_SCHEMA_VERSION,
    ...(await encryptBytes(
      session.key,
      utf8(JSON.stringify(normalized)),
      'patient-snapshot',
      'current',
    )),
  };
}

async function storedVaultWithSnapshot(
  stored: StoredVault,
  snapshot: PatientVaultSnapshot,
): Promise<StoredVault> {
  if (!session || session.mode !== stored.mode) throw new PatientVaultLockedError();
  const record = await snapshotRecord(snapshot);
  return stored.mode === 'native-keychain'
    ? { ...stored, snapshot: record as EncryptedRecord }
    : { ...stored, snapshot: record as PlainRecord };
}

function emit(name: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(name));
}

export function acknowledgePatientVaultUiCleared(): void {
  if (typeof window === 'undefined') return;
  queueMicrotask(() => emit(PATIENT_VAULT_UI_CLEARED_EVENT));
}

export function isPatientVaultUnlocked(): boolean {
  return session !== undefined;
}

export async function patientVaultExists(): Promise<boolean> {
  return (await readStoredVault()) !== undefined;
}

export async function patientVaultStorageMode(): Promise<PatientVaultStorageMode | undefined> {
  return (await readStoredVault())?.mode;
}

export function lockPatientVault(): void {
  if (session?.mode === 'native-keychain') session.rawKey.fill(0);
  session = undefined;
  emit(PATIENT_VAULT_LOCK_EVENT);
}

export async function createPatientVault(options?: {
  readonly allowUnencrypted?: boolean;
}): Promise<PatientVaultStorageMode> {
  if (await readStoredVault()) {
    throw new PatientVaultError('Пациентское хранилище уже создано.', 'storage');
  }
  if (options?.allowUnencrypted) {
    const stored: PlainStoredVault = {
      schemaVersion: PATIENT_VAULT_SCHEMA_VERSION,
      mode: 'unencrypted',
      snapshot: {
        type: 'patient-snapshot',
        id: 'current',
        version: PATIENT_VAULT_SCHEMA_VERSION,
        data: emptyPatientVaultSnapshot(),
      },
    };
    await writeStoredVault(stored);
    session = { mode: 'unencrypted' };
    emit(PATIENT_VAULT_EVENT);
    return stored.mode;
  }
  if (!isPatientVaultNativePlatform() || !(await isNativePatientVaultKeychainAvailable())) {
    throw new PatientVaultError(
      'Keychain/Keystore недоступен. Можно продолжить без шифрования после предупреждения.',
      'unavailable',
    );
  }
  const dataKey = await generateDataKey();
  try {
    const wrappedKey = await wrapPatientVaultKey(dataKey.rawKey);
    const encrypted = await encryptBytes(
      dataKey.key,
      utf8(JSON.stringify(emptyPatientVaultSnapshot())),
      'patient-snapshot',
      'current',
    );
    await writeStoredVault({
      schemaVersion: PATIENT_VAULT_SCHEMA_VERSION,
      mode: 'native-keychain',
      wrappedKey,
      snapshot: {
        type: 'patient-snapshot',
        id: 'current',
        version: PATIENT_VAULT_SCHEMA_VERSION,
        ...encrypted,
      },
    });
    session = { mode: 'native-keychain', ...dataKey };
    emit(PATIENT_VAULT_EVENT);
    return 'native-keychain';
  } catch (error) {
    dataKey.rawKey.fill(0);
    throw asStorageError(error, 'Keychain/Keystore не сохранил ключ хранилища.');
  }
}

export async function unlockPatientVault(): Promise<PatientVaultSnapshot> {
  lockPatientVault();
  const stored = await readStoredVault();
  if (!stored) throw new PatientVaultError('Пациентское хранилище ещё не создано.', 'storage');
  if (stored.mode === 'unencrypted') {
    const snapshot = normalizePatientVaultSnapshot(stored.snapshot.data);
    session = { mode: 'unencrypted' };
    emit(PATIENT_VAULT_EVENT);
    return snapshot;
  }
  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapPatientVaultKey(stored.wrappedKey);
  } catch (error) {
    throw new PatientVaultError(
      error instanceof Error ? error.message : 'Keychain/Keystore не открыл ключ хранилища.',
      'unavailable',
    );
  }
  try {
    const key = await importDataKey(rawKey);
    const plain = await decryptBytes(stored.snapshot, key);
    const snapshot = normalizePatientVaultSnapshot(
      JSON.parse(new TextDecoder().decode(plain)) as unknown,
    );
    session = { mode: 'native-keychain', key, rawKey };
    emit(PATIENT_VAULT_EVENT);
    return snapshot;
  } catch (error) {
    rawKey.fill(0);
    lockPatientVault();
    if (error instanceof PatientVaultError) throw error;
    throw new PatientVaultError('Повреждён снимок пациентского хранилища.', 'integrity');
  }
}

export async function readPatientVault(): Promise<PatientVaultSnapshot> {
  if (!session) throw new PatientVaultLockedError();
  try {
    const stored = await readStoredVault();
    if (!stored || stored.mode !== session.mode) throw new PatientVaultLockedError();
    if (stored.mode === 'unencrypted') {
      return normalizePatientVaultSnapshot(stored.snapshot.data);
    }
    if (session.mode !== 'native-keychain') throw new PatientVaultLockedError();
    const plain = await decryptBytes(stored.snapshot, session.key);
    return normalizePatientVaultSnapshot(JSON.parse(new TextDecoder().decode(plain)) as unknown);
  } catch (error) {
    lockPatientVault();
    if (error instanceof PatientVaultError) throw error;
    throw new PatientVaultError('Повреждён снимок пациентского хранилища.', 'integrity');
  }
}

export async function writePatientVault(snapshot: PatientVaultSnapshot): Promise<void> {
  if (!session) throw new PatientVaultLockedError();
  try {
    const stored = await readStoredVault();
    if (!stored) throw new PatientVaultError('Пациентское хранилище не найдено.', 'storage');
    await writeStoredVault(await storedVaultWithSnapshot(stored, snapshot));
    emit(PATIENT_VAULT_EVENT);
  } catch (error) {
    lockPatientVault();
    throw error;
  }
}

export function updatePatientVault(
  update: (snapshot: PatientVaultSnapshot) => PatientVaultSnapshot | Promise<PatientVaultSnapshot>,
): Promise<PatientVaultSnapshot> {
  return withPatientVaultMutation(async () => {
    const snapshot = await readPatientVault();
    const next = await update(snapshot);
    if (next !== snapshot) await writePatientVault(next);
    return next;
  });
}

async function storedBlob(input: {
  readonly id: string;
  readonly patientId?: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}): Promise<StoredBlob> {
  if (!session) throw new PatientVaultLockedError();
  const base: StoredBlobBase = {
    type: 'patient-file',
    id: input.id,
    version: PATIENT_VAULT_SCHEMA_VERSION,
    mimeType: input.mimeType,
    ...(input.patientId ? { patientId: input.patientId } : {}),
  };
  if (session.mode === 'unencrypted') {
    return { ...base, storage: 'plaintext', bytes: input.bytes.slice() };
  }
  return {
    ...base,
    storage: 'encrypted',
    ...(await encryptBytes(session.key, input.bytes, 'patient-file', input.id)),
  };
}

export async function addPatientBlob(input: {
  readonly id: string;
  readonly patientId?: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}): Promise<void> {
  if (!session) throw new PatientVaultLockedError();
  if (!input.id.trim() || !input.mimeType.trim()) {
    throw new PatientVaultError('Файл пациента имеет неверные метаданные.', 'storage');
  }
  try {
    if (input.patientId !== undefined) {
      const snapshot = await readPatientVault();
      if (!snapshot.profiles.some((profile) => profile.id === input.patientId)) {
        throw new PatientVaultError('Файл относится к неизвестному пациенту.', 'storage');
      }
    }
    const database = await openDatabase();
    try {
      const transaction = database.transaction(BLOB_STORE, 'readwrite');
      transaction.objectStore(BLOB_STORE).put(await storedBlob(input));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  } catch (error) {
    lockPatientVault();
    throw error;
  }
}

async function blobBytes(blob: StoredBlob): Promise<Uint8Array> {
  assertStoredBlob(blob);
  if (!session) throw new PatientVaultLockedError();
  if (blob.storage === 'plaintext') {
    if (session.mode !== 'unencrypted') throw new PatientVaultLockedError();
    return blob.bytes.slice();
  }
  if (session.mode !== 'native-keychain') throw new PatientVaultLockedError();
  return decryptBytes(blob, session.key);
}

export async function readPatientBlob(
  id: string,
): Promise<{ readonly mimeType: string; readonly bytes: Uint8Array } | undefined> {
  if (!session) throw new PatientVaultLockedError();
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(BLOB_STORE, 'readonly');
      const done = transactionDone(transaction);
      const stored = await requestResult(
        transaction.objectStore(BLOB_STORE).get(id) as IDBRequest<StoredBlob | undefined>,
      );
      await done;
      return stored ? { mimeType: stored.mimeType, bytes: await blobBytes(stored) } : undefined;
    } finally {
      database.close();
    }
  } catch (error) {
    lockPatientVault();
    throw error;
  }
}

async function writeSnapshotAndDeletePatientBlobs(
  snapshot: PatientVaultSnapshot,
  patientId: string,
): Promise<void> {
  if (!session) throw new PatientVaultLockedError();
  const stored = await readStoredVault();
  if (!stored) throw new PatientVaultError('Пациентское хранилище не найдено.', 'storage');
  const nextStored = await storedVaultWithSnapshot(stored, snapshot);
  const database = await openDatabase();
  try {
    const transaction = database.transaction([VAULT_STORE, BLOB_STORE], 'readwrite');
    transaction.objectStore(VAULT_STORE).put(nextStored, VAULT_KEY);
    const blobStore = transaction.objectStore(BLOB_STORE);
    const done = transactionDone(transaction);
    const getAll = blobStore.getAll() as IDBRequest<StoredBlob[]>;
    await new Promise<void>((resolve, reject) => {
      getAll.onsuccess = () => {
        for (const blob of getAll.result) {
          if (blob.patientId === patientId) blobStore.delete(blob.id);
        }
        resolve();
      };
      getAll.onerror = () =>
        reject(getAll.error ?? new PatientVaultError('Ошибка IndexedDB.', 'storage'));
    });
    await done;
  } finally {
    database.close();
  }
}

export async function deletePatientFromVault(patientId: string): Promise<void> {
  try {
    await withPatientVaultMutation(async () => {
      const snapshot = await readPatientVault();
      await writeSnapshotAndDeletePatientBlobs(
        removePatientFromSnapshot(snapshot, patientId),
        patientId,
      );
      emit(PATIENT_VAULT_EVENT);
    });
  } catch (error) {
    lockPatientVault();
    throw error;
  }
}

export async function exportPatientVaultBackup(patientId?: string): Promise<PatientVaultBackup> {
  if (!session) throw new PatientVaultLockedError();
  try {
    const sourceSnapshot = await readPatientVault();
    const snapshot = patientId
      ? selectPatientFromSnapshot(sourceSnapshot, patientId)
      : sourceSnapshot;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(BLOB_STORE, 'readonly');
      const done = transactionDone(transaction);
      const storedBlobs = await requestResult(
        transaction.objectStore(BLOB_STORE).getAll() as IDBRequest<StoredBlob[]>,
      );
      await done;
      const selected = patientId
        ? storedBlobs.filter((blob) => blob.patientId === patientId)
        : storedBlobs;
      const blobs: PatientVaultBackupBlob[] = [];
      for (const blob of selected) {
        blobs.push({
          id: blob.id,
          mimeType: blob.mimeType,
          ...(blob.patientId ? { patientId: blob.patientId } : {}),
          bytesBase64: bytesToBase64(await blobBytes(blob)),
        });
      }
      return parseBackup({
        kind: 'minimed-patient-vault-backup',
        schemaVersion: PATIENT_VAULT_SCHEMA_VERSION,
        snapshot,
        blobs,
      });
    } finally {
      database.close();
    }
  } catch (error) {
    if (isPatientVaultUnlocked()) lockPatientVault();
    throw error;
  }
}

export async function importPatientVaultBackup(value: unknown): Promise<void> {
  if (!session) throw new PatientVaultLockedError();
  try {
    const backup = parseBackup(value);
    const stored = await readStoredVault();
    if (!stored) throw new PatientVaultError('Пациентское хранилище не найдено.', 'storage');
    const nextStored = await storedVaultWithSnapshot(stored, backup.snapshot);
    const nextBlobs: StoredBlob[] = [];
    for (const blob of backup.blobs) {
      nextBlobs.push(
        await storedBlob({
          id: blob.id,
          mimeType: blob.mimeType,
          ...(blob.patientId ? { patientId: blob.patientId } : {}),
          bytes: base64ToBytes(blob.bytesBase64),
        }),
      );
    }
    const database = await openDatabase();
    try {
      const transaction = database.transaction([VAULT_STORE, BLOB_STORE], 'readwrite');
      transaction.objectStore(VAULT_STORE).put(nextStored, VAULT_KEY);
      const blobStore = transaction.objectStore(BLOB_STORE);
      blobStore.clear();
      for (const blob of nextBlobs) blobStore.put(blob);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
    emit(PATIENT_VAULT_EVENT);
  } catch (error) {
    lockPatientVault();
    if (error instanceof PatientVaultError) throw error;
    throw new PatientVaultError('Повреждён снимок резервной копии.', 'integrity');
  }
}

export async function deletePatientVault(): Promise<void> {
  lockPatientVault();
  await deletePatientVaultNativeKey();
  await Promise.all([deleteDatabase(DATABASE_NAME), ...LEGACY_DATABASE_NAMES.map(deleteDatabase)]);
  emit(PATIENT_VAULT_EVENT);
}

export function installPatientVaultLifecycle(
  onLock = lockPatientVault,
  vaultIsUnlocked = isPatientVaultUnlocked,
): () => void {
  lifecycleCleanup?.();
  if (typeof window === 'undefined') return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let patientUiCleared = false;
  const cancelScheduledLock = (): void => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const setCurtain = (): void => {
    document.documentElement.classList.add('patient-vault--privacy-curtain');
  };
  const clearCurtain = (): void => {
    if (document.visibilityState === 'hidden') return;
    if (vaultIsUnlocked() || patientUiCleared) {
      document.documentElement.classList.remove('patient-vault--privacy-curtain');
    }
  };
  const scheduleLock = (): void => {
    if (!vaultIsUnlocked()) return;
    cancelScheduledLock();
    timer = setTimeout(() => {
      timer = undefined;
      setCurtain();
      onLock();
    }, 5 * 60_000);
  };
  const immediatePrivacy = (): void => {
    if (!vaultIsUnlocked()) return;
    setCurtain();
    scheduleLock();
  };
  const restorePrivacy = (): void => {
    if (vaultIsUnlocked()) {
      patientUiCleared = false;
      clearCurtain();
      scheduleLock();
    } else {
      clearCurtain();
    }
  };
  const onActivity = (): void => {
    if (document.visibilityState === 'visible') scheduleLock();
  };
  const onVisibility = (): void =>
    document.visibilityState === 'hidden' ? immediatePrivacy() : restorePrivacy();
  const onPageHide = (): void => {
    if (!vaultIsUnlocked()) return;
    immediatePrivacy();
    onLock();
  };
  const onVaultChange = (): void => {
    if (vaultIsUnlocked()) {
      patientUiCleared = false;
      clearCurtain();
      scheduleLock();
      return;
    }
    cancelScheduledLock();
    patientUiCleared = false;
    setCurtain();
  };
  const onPatientUiCleared = (): void => {
    patientUiCleared = true;
    clearCurtain();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', immediatePrivacy);
  window.addEventListener('focus', restorePrivacy);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pointerdown', onActivity, { passive: true });
  window.addEventListener('keydown', onActivity, { passive: true });
  window.addEventListener('touchstart', onActivity, { passive: true });
  window.addEventListener('mousemove', onActivity, { passive: true });
  window.addEventListener(PATIENT_VAULT_EVENT, onVaultChange);
  window.addEventListener(PATIENT_VAULT_LOCK_EVENT, onVaultChange);
  window.addEventListener(PATIENT_VAULT_UI_CLEARED_EVENT, onPatientUiCleared);
  scheduleLock();
  lifecycleCleanup = () => {
    cancelScheduledLock();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', immediatePrivacy);
    window.removeEventListener('focus', restorePrivacy);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pointerdown', onActivity);
    window.removeEventListener('keydown', onActivity);
    window.removeEventListener('touchstart', onActivity);
    window.removeEventListener('mousemove', onActivity);
    window.removeEventListener(PATIENT_VAULT_EVENT, onVaultChange);
    window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, onVaultChange);
    window.removeEventListener(PATIENT_VAULT_UI_CLEARED_EVENT, onPatientUiCleared);
    if (document.visibilityState !== 'hidden' && vaultIsUnlocked()) {
      document.documentElement.classList.remove('patient-vault--privacy-curtain');
    }
    lifecycleCleanup = undefined;
  };
  return lifecycleCleanup;
}

export const PATIENT_VAULT_CRYPTO_PARAMETERS = {
  cipher: 'AES-256-GCM',
  ivBytes: IV_BYTES,
  schemaVersion: PATIENT_DOMAIN_SCHEMA_VERSION,
  storageSchemaVersion: PATIENT_VAULT_SCHEMA_VERSION,
} as const;
