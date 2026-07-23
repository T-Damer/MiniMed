import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  InstalledContentModule,
} from '@localmed/contracts';
import {
  type ContentModuleArtifactBackend,
  type ContentModuleArtifactDownloader,
  type ContentModuleIndexValidator,
  ForegroundContentModuleInstaller,
  type StagedContentModuleArtifact,
} from '@localmed/core';
import {
  type MedicalStoreMount,
  PersistentInstalledModuleRegistry,
  WebStorageInstalledModuleRegistryPersistence,
} from '@localmed/storage';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

import { commitRegistryAndArtifactMutation } from './module-registry-transaction';

const DATABASE_NAME = 'minimed-content-modules-v1';
const DATABASE_VERSION = 1;
const VERSIONS_STORE = 'versions';
const ACTIVE_STORE = 'active';
const CORE_MODULE_ID = 'minimed.core.ru';
const CORE_VERSION = '1.0.0-preview.1';
const CORE_SOURCE_SET_DIGEST =
  'sha256:6feb828182adfc45907c902bc39428dbf53c95fb25d09dd29281989660678acf';

type ModuleArtifact = ContentModuleCatalogEntry['artifacts'][number];

interface StoredModuleVersion {
  readonly key: string;
  readonly moduleId: string;
  readonly version: string;
  readonly bytes: ArrayBuffer;
  readonly sourceSetDigest: string;
  readonly installedAt: string;
}

interface ActiveModulePointer {
  readonly moduleId: string;
  readonly version: string;
}

interface StagedBytes {
  readonly moduleId: string;
  readonly version: string;
  readonly artifact: ModuleArtifact;
  readonly bytes: Uint8Array;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка локального хранилища.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Ошибка локального хранилища.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Операция с хранилищем отменена.'));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(VERSIONS_STORE)) {
        database.createObjectStore(VERSIONS_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(ACTIVE_STORE)) {
        database.createObjectStore(ACTIVE_STORE, { keyPath: 'moduleId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть хранилище модулей.'));
  });
}

function versionKey(moduleId: string, version: string): string {
  return `${moduleId}@${version}`;
}

async function readActivePointers(database: IDBDatabase): Promise<readonly ActiveModulePointer[]> {
  const transaction = database.transaction(ACTIVE_STORE, 'readonly');
  const pointers = await requestResult(
    transaction.objectStore(ACTIVE_STORE).getAll() as IDBRequest<ActiveModulePointer[]>,
  );
  await transactionDone(transaction);
  return pointers;
}

async function readVersion(
  database: IDBDatabase,
  moduleId: string,
  version: string,
): Promise<StoredModuleVersion | null> {
  const transaction = database.transaction(VERSIONS_STORE, 'readonly');
  const value = await requestResult(
    transaction.objectStore(VERSIONS_STORE).get(versionKey(moduleId, version)) as IDBRequest<
      StoredModuleVersion | undefined
    >,
  );
  await transactionDone(transaction);
  return value ?? null;
}

class BrowserModuleDownloader implements ContentModuleArtifactDownloader {
  public async download(
    artifact: ModuleArtifact,
    signal: AbortSignal,
    onProgress: (progress: { downloadedBytes: number; totalBytes: number | null }) => void,
  ): Promise<Uint8Array> {
    if (!artifact.url) throw new Error('Для набора не указан адрес загрузки.');
    if (artifact.compression !== 'none') {
      throw new Error('Сжатые наборы пока не поддерживаются этим установщиком.');
    }
    const response = await fetch(artifact.url, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Сервер базы знаний ответил HTTP ${response.status}.`);
    const totalHeader = Number(response.headers.get('content-length'));
    const totalBytes =
      Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : artifact.sizeBytes;
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      onProgress({ downloadedBytes: bytes.byteLength, totalBytes });
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      downloadedBytes += result.value.byteLength;
      onProgress({ downloadedBytes, totalBytes });
    }
    const bytes = new Uint8Array(downloadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
}

class BrowserModuleBackend implements ContentModuleArtifactBackend {
  private readonly staged = new Map<string, StagedBytes>();

  public async stage(
    module: ContentModuleCatalogEntry,
    artifact: ModuleArtifact,
    bytes: Uint8Array,
  ): Promise<StagedContentModuleArtifact> {
    const token = `${module.id}@${module.version}:${artifact.id}`;
    this.staged.set(token, { moduleId: module.id, version: module.version, artifact, bytes });
    return {
      artifactId: artifact.id,
      kind: artifact.kind,
      sizeBytes: bytes.byteLength,
      token,
    };
  }

  public async activate(
    module: ContentModuleCatalogEntry,
    artifacts: readonly StagedContentModuleArtifact[],
  ) {
    const index = artifacts.find((artifact) => artifact.kind === 'index');
    if (!index) throw new Error('В наборе нет поисковой базы.');
    const staged = this.staged.get(index.token);
    if (!staged) throw new Error('Временный файл набора потерян.');
    const database = await openDatabase();
    try {
      const previousTransaction = database.transaction(ACTIVE_STORE, 'readonly');
      const previous = await requestResult(
        previousTransaction.objectStore(ACTIVE_STORE).get(module.id) as IDBRequest<
          ActiveModulePointer | undefined
        >,
      );
      await transactionDone(previousTransaction);

      const transaction = database.transaction([VERSIONS_STORE, ACTIVE_STORE], 'readwrite');
      const storedBytes = staged.bytes.slice().buffer;
      const stored: StoredModuleVersion = {
        key: versionKey(module.id, module.version),
        moduleId: module.id,
        version: module.version,
        bytes: storedBytes,
        sourceSetDigest: module.sourceSetDigest ?? '',
        installedAt: new Date().toISOString(),
      };
      transaction.objectStore(VERSIONS_STORE).put(stored);
      transaction.objectStore(ACTIVE_STORE).put({ moduleId: module.id, version: module.version });
      await transactionDone(transaction);
      return {
        moduleId: module.id,
        version: module.version,
        installedSizeBytes: staged.bytes.byteLength,
        token: JSON.stringify(previous ?? null),
      };
    } finally {
      database.close();
    }
  }

  public async restore(receipt: {
    readonly moduleId: string;
    readonly token: string;
  }): Promise<void> {
    const previous = JSON.parse(receipt.token) as ActiveModulePointer | null;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(ACTIVE_STORE, 'readwrite');
      if (previous) transaction.objectStore(ACTIVE_STORE).put(previous);
      else transaction.objectStore(ACTIVE_STORE).delete(receipt.moduleId);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  public async discardStaging(moduleId: string, version: string): Promise<void> {
    for (const [token, staged] of this.staged) {
      if (staged.moduleId === moduleId && staged.version === version) this.staged.delete(token);
    }
  }

  public async remove(moduleId: string): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction([VERSIONS_STORE, ACTIVE_STORE], 'readwrite');
      transaction.objectStore(ACTIVE_STORE).delete(moduleId);
      const store = transaction.objectStore(VERSIONS_STORE);
      const keys = await requestResult(store.getAllKeys());
      for (const key of keys) {
        if (String(key).startsWith(`${moduleId}@`)) store.delete(key);
      }
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  public async setActive(moduleId: string, version: string): Promise<void> {
    const database = await openDatabase();
    try {
      const stored = await readVersion(database, moduleId, version);
      if (!stored) throw new Error('Предыдущая версия набора не найдена на устройстве.');
      const transaction = database.transaction(ACTIVE_STORE, 'readwrite');
      transaction.objectStore(ACTIVE_STORE).put({ moduleId, version });
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}

class BrowserModuleValidator implements ContentModuleIndexValidator {
  public async validate(module: ContentModuleCatalogEntry, indexBytes: Uint8Array) {
    let store: SqliteMedicalStore | null = null;
    try {
      store = await SqliteMedicalStore.createFromBytes(indexBytes);
      const health = await store.initialize();
      const integrity = await store.inspectIntegrity();
      const schemaCompatible = health.schemaVersion === module.compatibility.schemaVersion;
      const valid =
        integrity.integrity === 'ok' &&
        integrity.foreignKeyViolations === 0 &&
        integrity.chunkCount === integrity.ftsRowCount &&
        schemaCompatible;
      return {
        checkedAt: new Date().toISOString(),
        valid,
        checksumValid: true,
        schemaCompatible,
        sqliteIntegrity: valid ? ('ok' as const) : ('failed' as const),
        message: valid
          ? `Проверено: ${health.documentCount} документов, ${integrity.chunkCount} фрагментов.`
          : 'Загруженная база не прошла проверку целостности.',
      };
    } catch (cause) {
      return {
        checkedAt: new Date().toISOString(),
        valid: false,
        checksumValid: true,
        schemaCompatible: false,
        sqliteIntegrity: 'failed' as const,
        message: cause instanceof Error ? cause.message : 'Не удалось проверить загруженную базу.',
      };
    } finally {
      await store?.close().catch(() => undefined);
    }
  }
}

function createRegistry(): PersistentInstalledModuleRegistry {
  const registry = new PersistentInstalledModuleRegistry(
    new WebStorageInstalledModuleRegistryPersistence(window.localStorage),
  );
  if (!registry.get(CORE_MODULE_ID)) {
    registry.activate({
      moduleId: CORE_MODULE_ID,
      version: CORE_VERSION,
      required: true,
      installedAt: new Date().toISOString(),
      installedSizeBytes: 0,
      sourceSetDigest: CORE_SOURCE_SET_DIGEST,
      validation: {
        checkedAt: new Date().toISOString(),
        valid: true,
        checksumValid: true,
        schemaCompatible: true,
        sqliteIntegrity: 'ok',
        message: 'Встроенное ядро MiniMed.',
      },
    });
  }
  return registry;
}

export class BrowserContentModuleRuntime {
  private readonly registry: PersistentInstalledModuleRegistry;
  private readonly backend = new BrowserModuleBackend();
  private readonly installer: ForegroundContentModuleInstaller;

  public constructor(catalog: ContentModuleCatalog) {
    this.registry = createRegistry();
    this.installer = new ForegroundContentModuleInstaller(
      catalog,
      { appVersion: '0.3.3', schemaVersion: 2, coreCatalogVersion: '1' },
      new BrowserModuleDownloader(),
      this.backend,
      new BrowserModuleValidator(),
      this.registry,
    );
  }

  public listInstalled(): readonly InstalledContentModule[] {
    return this.registry.list().filter((module) => module.moduleId !== CORE_MODULE_ID);
  }

  public listTasks(): readonly ContentModuleDownloadTask[] {
    return this.installer.listTasks();
  }

  public subscribe(listener: (task: ContentModuleDownloadTask) => void): () => void {
    return this.installer.subscribe(listener);
  }

  public install(module: ContentModuleCatalogEntry): ContentModuleDownloadTask {
    return this.installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: false,
    });
  }

  public wait(taskId: string): Promise<ContentModuleDownloadTask> {
    return this.installer.wait(taskId);
  }

  public async remove(moduleId: string): Promise<void> {
    await commitRegistryAndArtifactMutation(
      this.registry,
      () => this.registry.remove(moduleId),
      () => this.backend.remove(moduleId),
    );
  }

  public async rollback(moduleId: string): Promise<InstalledContentModule> {
    return commitRegistryAndArtifactMutation(
      this.registry,
      () => this.registry.rollback(moduleId),
      (installed) => this.backend.setActive(moduleId, installed.version),
    );
  }
}

export async function loadInstalledModuleMounts(): Promise<readonly MedicalStoreMount[]> {
  if (!('indexedDB' in window)) return [];
  const database = await openDatabase();
  try {
    const pointers = await readActivePointers(database);
    const mounts: MedicalStoreMount[] = [];
    for (const pointer of pointers) {
      const stored = await readVersion(database, pointer.moduleId, pointer.version);
      if (!stored) continue;
      try {
        const store = await SqliteMedicalStore.createFromBytes(
          new Uint8Array(stored.bytes.slice(0)),
        );
        mounts.push({ moduleId: pointer.moduleId, store, enabled: true, searchWeight: 1 });
      } catch (cause) {
        console.warn(`Unable to mount content module ${pointer.moduleId}.`, cause);
      }
    }
    return mounts;
  } finally {
    database.close();
  }
}
