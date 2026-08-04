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

import {
  ASSESSMENT_CATALOG,
  preloadAssessmentDefinitions,
} from '@/features/assessments/assessment-catalog';
import { findAssessmentDependenciesInStore } from '@/features/assessments/assessment-module-dependencies';
import {
  pruneAssessmentModuleDependencies,
  removeAssessmentModuleDependencies,
  setAssessmentModuleDependencies,
} from '@/features/assessments/assessment-packs';
import { resolveContentModuleArtifactUrl } from '@/features/modules/artifact-url';
import { commitRegistryAndArtifactMutation } from '@/features/modules/module-registry-transaction';
import {
  dequeuePendingModuleInstall,
  discardPendingModuleInstall,
  enqueuePendingModuleInstall,
  recoverPendingModuleInstalls,
} from '@/features/modules/pending-module-installs';
import { downloadWithRetry, isTransientDownloadError } from '@/features/network/download-retry';
import { RELEASE_VERSION } from '../../../../../release';

const DATABASE_NAME = 'minimed-content-modules-v1';
const DATABASE_VERSION = 1;
const VERSIONS_STORE = 'versions';
const ACTIVE_STORE = 'active';
const CORE_MODULE_ID = 'minimed.core.ru';
const CORE_VERSION = '1.0.0-preview.1';
const CORE_SOURCE_SET_DIGEST =
  'sha256:6feb828182adfc45907c902bc39428dbf53c95fb25d09dd29281989660678acf';
const MODULE_RETRY_DELAYS_MS = [1_000, 2_500, 5_000] as const;
const MODULE_REQUEUE_DELAY_MS = 15_000;

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
    const resolvedUrl = resolveContentModuleArtifactUrl(artifact.url);
    const cacheKey = artifact.sha256 ?? `${artifact.id}:${resolvedUrl}`;
    return downloadWithRetry({
      url: resolvedUrl,
      cacheKey,
      expectedBytes: artifact.sizeBytes,
      signal,
      retryDelaysMs: MODULE_RETRY_DELAYS_MS,
      onProgress: ({ downloadedBytes, totalBytes }) => onProgress({ downloadedBytes, totalBytes }),
    });
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
      await this.discardStaging(module.id, module.version);
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

  public async readIndexBytes(moduleId: string, version: string): Promise<Uint8Array | null> {
    const database = await openDatabase();
    try {
      const stored = await readVersion(database, moduleId, version);
      return stored ? new Uint8Array(stored.bytes.slice(0)) : null;
    } finally {
      database.close();
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
  private catalog: ContentModuleCatalog;
  private readonly registry: PersistentInstalledModuleRegistry;
  private readonly backend = new BrowserModuleBackend();
  private readonly installer: ForegroundContentModuleInstaller;
  private readonly retryTimers = new Map<string, number>();
  private readonly assessmentDependencyScans = new Map<string, Promise<void>>();
  private readonly handleOnline = (): void => {
    for (const timer of this.retryTimers.values()) window.clearTimeout(timer);
    this.retryTimers.clear();
    recoverPendingModuleInstalls(
      this,
      this.catalog,
      new Set(this.listInstalled().map((module) => module.moduleId)),
    );
  };

  public constructor(catalog: ContentModuleCatalog) {
    this.catalog = catalog;
    this.registry = createRegistry();
    this.installer = new ForegroundContentModuleInstaller(
      catalog,
      { appVersion: RELEASE_VERSION, schemaVersion: 2, coreCatalogVersion: '1' },
      new BrowserModuleDownloader(),
      this.backend,
      new BrowserModuleValidator(),
      this.registry,
      3,
    );
    this.installer.subscribe((task) => {
      if (task.state === 'completed') {
        this.clearRetry(task.moduleId, task.version);
        dequeuePendingModuleInstall(task.moduleId, task.version);
        void this.syncAssessmentDependencies(task.moduleId, task.version).catch((cause: unknown) => {
          console.warn(`Unable to resolve questionnaire dependencies for ${task.moduleId}.`, cause);
        });
      } else if (task.state === 'cancelled') {
        this.clearRetry(task.moduleId, task.version);
        discardPendingModuleInstall(task.moduleId, task.version);
      } else if (task.state === 'failed') {
        if (isTransientDownloadError(new Error(task.errorMessage ?? ''))) {
          this.scheduleRetry(task);
        } else {
          discardPendingModuleInstall(task.moduleId, task.version);
        }
      }
    });
    window.addEventListener('online', this.handleOnline);
    recoverPendingModuleInstalls(
      this,
      catalog,
      new Set(this.listInstalled().map((module) => module.moduleId)),
    );
    this.reconcileAssessmentDependencies();
  }

  private retryKey(moduleId: string, version: string): string {
    return `${moduleId}@${version}`;
  }

  private clearRetry(moduleId: string, version: string): void {
    const key = this.retryKey(moduleId, version);
    const timer = this.retryTimers.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    this.retryTimers.delete(key);
  }

  private scheduleRetry(task: ContentModuleDownloadTask): void {
    const key = this.retryKey(task.moduleId, task.version);
    if (this.retryTimers.has(key)) return;
    const timer = window.setTimeout(() => {
      this.retryTimers.delete(key);
      if (navigator.onLine === false) {
        this.scheduleRetry(task);
        return;
      }
      const module = this.catalog.modules.find(
        (candidate) => candidate.id === task.moduleId && candidate.version === task.version,
      );
      if (module?.releaseState !== 'published') {
        discardPendingModuleInstall(task.moduleId, task.version);
        return;
      }
      try {
        this.install(module);
      } catch {
        discardPendingModuleInstall(task.moduleId, task.version);
      }
    }, MODULE_REQUEUE_DELAY_MS);
    this.retryTimers.set(key, timer);
  }

  private reconcileAssessmentDependencies(): void {
    const installed = new Map(
      this.listInstalled().map((module) => [module.moduleId, module.version] as const),
    );
    const state = pruneAssessmentModuleDependencies(installed, ASSESSMENT_CATALOG);
    for (const [moduleId, version] of installed) {
      const descriptor = this.catalog.modules.find(
        (module) => module.id === moduleId && module.version === version,
      );
      if (descriptor?.kind !== 'clinical') {
        removeAssessmentModuleDependencies(moduleId, ASSESSMENT_CATALOG);
        continue;
      }
      if (state.moduleDependencies[moduleId]?.version === version) continue;
      void this.syncAssessmentDependencies(moduleId, version).catch((cause: unknown) => {
        console.warn(`Unable to reconcile questionnaire dependencies for ${moduleId}.`, cause);
      });
    }
  }

  private syncAssessmentDependencies(moduleId: string, version: string): Promise<void> {
    const key = this.retryKey(moduleId, version);
    const existing = this.assessmentDependencyScans.get(key);
    if (existing) return existing;
    const scan = this.scanAssessmentDependencies(moduleId, version).finally(() => {
      this.assessmentDependencyScans.delete(key);
    });
    this.assessmentDependencyScans.set(key, scan);
    return scan;
  }

  private async scanAssessmentDependencies(moduleId: string, version: string): Promise<void> {
    const descriptor = this.catalog.modules.find(
      (module) => module.id === moduleId && module.version === version,
    );
    if (descriptor?.kind !== 'clinical') {
      removeAssessmentModuleDependencies(moduleId, ASSESSMENT_CATALOG);
      return;
    }
    const bytes = await this.backend.readIndexBytes(moduleId, version);
    if (!bytes) {
      removeAssessmentModuleDependencies(moduleId, ASSESSMENT_CATALOG);
      return;
    }
    let store: SqliteMedicalStore | null = null;
    try {
      store = await SqliteMedicalStore.createFromBytes(bytes);
      await store.initialize();
      const assessmentIds = await findAssessmentDependenciesInStore(store);
      if (assessmentIds.length > 0) {
        await preloadAssessmentDefinitions(assessmentIds).catch((cause: unknown) => {
          console.warn(`Unable to preload questionnaires required by ${moduleId}.`, cause);
        });
      }
      setAssessmentModuleDependencies(
        moduleId,
        version,
        assessmentIds,
        ASSESSMENT_CATALOG,
      );
    } finally {
      await store?.close().catch(() => undefined);
    }
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
    this.clearRetry(module.id, module.version);
    enqueuePendingModuleInstall(module.id, module.version, false);
    return this.installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: false,
    });
  }

  public updateCatalog(catalog: ContentModuleCatalog): void {
    this.catalog = catalog;
    this.installer.updateCatalog(catalog);
    recoverPendingModuleInstalls(
      this,
      catalog,
      new Set(this.listInstalled().map((module) => module.moduleId)),
    );
    this.reconcileAssessmentDependencies();
  }

  public getCatalog(): ContentModuleCatalog {
    return this.catalog;
  }

  public wait(taskId: string): Promise<ContentModuleDownloadTask> {
    return this.installer.wait(taskId);
  }

  public isRetryScheduled(task: ContentModuleDownloadTask): boolean {
    return this.retryTimers.has(this.retryKey(task.moduleId, task.version));
  }

  public retry(taskId: string): ContentModuleDownloadTask {
    const task = this.installer.listTasks().find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Неизвестная задача загрузки: ${taskId}.`);
    const module = this.catalog.modules.find(
      (candidate) => candidate.id === task.moduleId && candidate.version === task.version,
    );
    if (!module) throw new Error(`Набор ${task.moduleId}@${task.version} отсутствует в каталоге.`);
    return this.install(module);
  }

  public retryFailed(): void {
    const retried = new Set<string>();
    for (const task of this.installer.listTasks().toReversed()) {
      const key = this.retryKey(task.moduleId, task.version);
      if (task.state !== 'failed' || retried.has(key)) continue;
      retried.add(key);
      this.retry(task.id);
    }
  }

  public cancel(taskId: string): void {
    const task = this.installer.cancel(taskId);
    this.clearRetry(task.moduleId, task.version);
    discardPendingModuleInstall(task.moduleId, task.version);
  }

  public cancelAll(): void {
    for (const task of this.installer.listTasks()) {
      if (
        !['completed', 'failed', 'cancelled'].includes(task.state) ||
        this.isRetryScheduled(task)
      ) {
        this.cancel(task.id);
      }
    }
  }

  public dispose(): void {
    this.cancelAll();
    for (const timer of this.retryTimers.values()) window.clearTimeout(timer);
    this.retryTimers.clear();
    window.removeEventListener('online', this.handleOnline);
  }

  public async remove(moduleId: string): Promise<void> {
    await commitRegistryAndArtifactMutation(
      this.registry,
      () => this.registry.remove(moduleId),
      () => this.backend.remove(moduleId),
    );
    removeAssessmentModuleDependencies(moduleId, ASSESSMENT_CATALOG);
  }

  public async rollback(moduleId: string, version?: string): Promise<InstalledContentModule> {
    const installed = await commitRegistryAndArtifactMutation(
      this.registry,
      () => this.registry.rollback(moduleId, version),
      (next) => this.backend.setActive(moduleId, next.version),
    );
    await this.syncAssessmentDependencies(moduleId, installed.version);
    return installed;
  }
}

export async function loadInstalledModuleMounts(): Promise<readonly MedicalStoreMount[]> {
  if (!('indexedDB' in globalThis)) return [];
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
