import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  InstalledContentModule,
  ToolDefinitionRecord,
} from '@localmed/contracts';
import {
  type ContentModuleArtifactBackend,
  type ContentModuleArtifactDownloader,
  type ContentModuleIndexValidator,
  ForegroundContentModuleInstaller,
  type StagedContentModuleArtifact,
} from '@localmed/core';
import {
  type InstalledModuleRegistry,
  type MedicalStoreMount,
  PersistentInstalledModuleRegistry,
  WebStorageInstalledModuleRegistryPersistence,
} from '@localmed/storage';
import { SQLITE_WASM_DESERIALIZE_MAX_BYTES, SqliteMedicalStore } from '@localmed/storage-sqlite';
import { WorkerOpfsMedicalStore } from '@/composition/worker-opfs-medical-store';
import {
  getAssessmentCatalog,
  preloadAssessmentDefinitions,
} from '@/features/assessments/assessment-catalog';
import { findAssessmentDependenciesInStore } from '@/features/assessments/assessment-module-dependencies';
import {
  pruneAssessmentModuleDependencies,
  removeAssessmentModuleDependencies,
  setAssessmentModuleDependencies,
} from '@/features/assessments/assessment-packs';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { resolveContentModuleArtifactUrl } from '@/features/modules/artifact-url';
import {
  contentModuleNeedsInstall,
  isModuleReleased,
  localPackagedModulesToInstall,
} from '@/features/modules/local-packaged-modules';
import { BUNDLED_CORE_MODULE } from '@/features/modules/module-catalog';
import { decodeModuleIndex } from '@/features/modules/module-index-compression';
import { commitRegistryAndArtifactMutation } from '@/features/modules/module-registry-transaction';
import {
  dequeuePendingModuleInstall,
  discardPendingModuleInstall,
  enqueuePendingModuleInstall,
  recoverPendingModuleInstalls,
  retireSupersededModuleDownloads,
} from '@/features/modules/pending-module-installs';
import { downloadWithRetry, isTransientDownloadError } from '@/features/network/download-retry';
import { RELEASE_VERSION } from '../../../../../release';

const DATABASE_NAME = 'minimed-content-modules-v1';
const DATABASE_VERSION = 1;
const VERSIONS_STORE = 'versions';
const ACTIVE_STORE = 'active';
const CORE_MODULE_ID = 'minimed.core.ru';
const MODULE_RETRY_DELAYS_MS = [1_000, 2_500, 5_000] as const;
const MODULE_REQUEUE_DELAY_MS = 15_000;
const MODULE_OPFS_FETCH_TIMEOUT_MS = 180_000;

type ModuleArtifact = ContentModuleCatalogEntry['artifacts'][number];

interface StoredModuleVersion {
  readonly key: string;
  readonly moduleId: string;
  readonly version: string;
  readonly bytes: ArrayBuffer;
  readonly sourceAssets?: readonly StoredModuleArtifact[];
  readonly sourceSetDigest: string;
  readonly installedAt: string;
}

interface StoredModuleArtifact {
  readonly artifactId: string;
  readonly compression: 'zip';
  readonly bytes: ArrayBuffer;
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

function moduleOpfsKey(moduleId: string, version: string): string {
  return `minimed-module-${encodeURIComponent(versionKey(moduleId, version))}`;
}

async function openModuleStore(
  moduleId: string,
  version: string,
  bytes: Uint8Array,
): Promise<SqliteMedicalStore | WorkerOpfsMedicalStore> {
  if (bytes.byteLength <= SQLITE_WASM_DESERIALIZE_MAX_BYTES) {
    return SqliteMedicalStore.createFromBytes(bytes);
  }

  const key = moduleOpfsKey(moduleId, version);
  // ponytail: OPFS copies survive remove/rollback; IndexedDB stays authoritative. Add per-version
  // OPFS deletion only with a cache lifecycle API.
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: 'application/vnd.sqlite3' }),
  );
  try {
    return await WorkerOpfsMedicalStore.open({
      url,
      databaseName: `${key}.db`,
      fetchTimeoutMs: MODULE_OPFS_FETCH_TIMEOUT_MS,
      poolName: key,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
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

export async function readActiveInstalledSourceAssets(
  moduleId: string,
  artifactId?: string,
): Promise<Uint8Array | null> {
  if (!('indexedDB' in globalThis)) return null;
  const database = await openDatabase();
  try {
    const active = (await readActivePointers(database)).find(
      (pointer) => pointer.moduleId === moduleId,
    );
    if (!active) return null;
    const stored = await readVersion(database, moduleId, active.version);
    const artifact = stored?.sourceAssets?.find(
      (candidate) => artifactId === undefined || candidate.artifactId === artifactId,
    );
    return artifact ? new Uint8Array(artifact.bytes.slice(0)) : null;
  } finally {
    database.close();
  }
}

class BrowserModuleDownloader implements ContentModuleArtifactDownloader {
  public async download(
    artifact: ModuleArtifact,
    signal: AbortSignal,
    onProgress: (progress: { downloadedBytes: number; totalBytes: number | null }) => void,
    module?: Pick<ContentModuleCatalogEntry, 'id' | 'version'>,
  ): Promise<Uint8Array> {
    if (!artifact.url) throw new Error('Для набора не указан адрес загрузки.');
    if (
      artifact.compression !== 'none' &&
      !(artifact.kind === 'index' && artifact.compression === 'gzip') &&
      !(artifact.kind === 'source-assets' && artifact.compression === 'zip')
    ) {
      throw new Error('Поддерживаются SQLite, gzip для SQLite и ZIP для изображений.');
    }
    const resolvedUrl = resolveContentModuleArtifactUrl(artifact.url);
    const cacheKey = artifact.sha256 ?? `${artifact.id}:${resolvedUrl}`;
    return downloadWithRetry({
      ...(module ? { jobId: `module:${module.id}@${module.version}`, trackProgress: false } : {}),
      url: resolvedUrl,
      cacheKey,
      expectedBytes: artifact.sizeBytes,
      signal,
      retryDelaysMs: MODULE_RETRY_DELAYS_MS,
      retryMissingAssets: false,
      onProgress: ({ downloadedBytes, totalBytes }) => onProgress({ downloadedBytes, totalBytes }),
    });
  }
}

export class BrowserModuleBackend implements ContentModuleArtifactBackend {
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
    const sourceAssets = module.artifacts
      .filter((artifact) => artifact.kind === 'source-assets')
      .map((artifact) => {
        const stagedArtifact = artifacts.find(
          (candidate) => candidate.artifactId === artifact.id && candidate.kind === 'source-assets',
        );
        if (!stagedArtifact) {
          if (artifact.required) {
            throw new Error(`Обязательный source-assets артефакт ${artifact.id} потерян.`);
          }
          return null;
        }
        const source = this.staged.get(stagedArtifact.token);
        if (!source) throw new Error('Временный файл source-assets набора потерян.');
        if (source.artifact.compression !== 'zip') {
          throw new Error(`Source-assets артефакт ${artifact.id} должен быть ZIP.`);
        }
        return {
          artifactId: artifact.id,
          compression: 'zip' as const,
          bytes: Uint8Array.from(source.bytes).buffer,
        };
      })
      .filter((artifact): artifact is StoredModuleArtifact => artifact !== null);
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
        ...(sourceAssets.length > 0 ? { sourceAssets } : {}),
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
        installedSizeBytes:
          staged.bytes.byteLength +
          sourceAssets.reduce((total, artifact) => total + artifact.bytes.byteLength, 0),
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

export class BrowserModuleValidator implements ContentModuleIndexValidator {
  public async validate(module: ContentModuleCatalogEntry, indexBytes: Uint8Array) {
    let store: SqliteMedicalStore | WorkerOpfsMedicalStore | null = null;
    try {
      store = await openModuleStore(module.id, module.version, indexBytes);
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

export function ensureBundledCore(
  registry: InstalledModuleRegistry,
  now = new Date().toISOString(),
): void {
  const current = registry.get(CORE_MODULE_ID);
  if (
    current?.version === BUNDLED_CORE_MODULE.version &&
    current.activeSourceSetDigest === BUNDLED_CORE_MODULE.sourceSetDigest
  ) {
    return;
  }
  registry.activate({
    moduleId: CORE_MODULE_ID,
    version: BUNDLED_CORE_MODULE.version,
    required: true,
    installedAt: current?.installedAt ?? now,
    installedSizeBytes: BUNDLED_CORE_MODULE.sizes.installedBytes,
    sourceSetDigest: BUNDLED_CORE_MODULE.sourceSetDigest,
    validation: {
      checkedAt: now,
      valid: true,
      checksumValid: true,
      schemaCompatible: true,
      sqliteIntegrity: 'ok',
      message: 'Встроенное ядро MiniMed.',
    },
  });
}

function createRegistry(): PersistentInstalledModuleRegistry {
  const registry = new PersistentInstalledModuleRegistry(
    new WebStorageInstalledModuleRegistryPersistence(window.localStorage),
  );
  ensureBundledCore(registry);
  return registry;
}

export class BrowserContentModuleRuntime {
  private catalog: ContentModuleCatalog;
  private readonly registry: PersistentInstalledModuleRegistry;
  private readonly backend = new BrowserModuleBackend();
  private readonly installer: ForegroundContentModuleInstaller;
  private readonly retryTimers = new Map<string, number>();
  private readonly assessmentDependencyScans = new Map<string, Promise<void>>();
  private readonly assessmentDependencyGenerations = new Map<string, number>();
  private disposed = false;
  private readonly localPackagedModulesReady: Promise<void>;
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
    for (const installed of this.registry.list()) {
      if (
        catalog.modules.some(
          (module) =>
            module.id === installed.moduleId &&
            module.version === installed.version &&
            module.sourceSetDigest === installed.activeSourceSetDigest,
        )
      ) {
        retireSupersededModuleDownloads(getDownloadQueue(), installed.moduleId, installed.version);
      }
    }
    this.installer = new ForegroundContentModuleInstaller(
      catalog,
      { appVersion: RELEASE_VERSION, schemaVersion: 2, coreCatalogVersion: '1' },
      new BrowserModuleDownloader(),
      this.backend,
      new BrowserModuleValidator(),
      this.registry,
      3,
      decodeModuleIndex,
    );
    this.installer.subscribe((task) => {
      if (task.state === 'completed') {
        retireSupersededModuleDownloads(getDownloadQueue(), task.moduleId, task.version);
        this.clearRetry(task.moduleId, task.version);
        dequeuePendingModuleInstall(task.moduleId, task.version);
        void this.syncAssessmentDependencies(task.moduleId, task.version).catch(
          (cause: unknown) => {
            console.warn(
              `Unable to resolve questionnaire dependencies for ${task.moduleId}.`,
              cause,
            );
          },
        );
      } else if (task.state === 'cancelled') {
        this.clearRetry(task.moduleId, task.version);
        discardPendingModuleInstall(task.moduleId, task.version);
      } else if (task.state === 'failed') {
        if (
          !task.errorMessage?.toLowerCase().includes('http 404') &&
          isTransientDownloadError(new Error(task.errorMessage ?? ''))
        ) {
          this.scheduleRetry(task);
        } else {
          discardPendingModuleInstall(task.moduleId, task.version);
        }
      }
      const descriptor = this.catalog.modules.find(
        (item) => item.id === task.moduleId && item.version === task.version,
      );
      getDownloadQueue().observe(
        {
          id: `module:${task.moduleId}@${task.version}`,
          kind: 'module',
          title: descriptor?.title ?? 'Набор документов',
          totalBytes: task.totalBytes,
        },
        {
          state: this.isRetryScheduled(task) ? 'retrying' : task.state,
          downloadedBytes: task.downloadedBytes,
          totalBytes: task.totalBytes,
          errorMessage:
            task.state === 'failed'
              ? task.errorMessage?.includes('conflicting source-set digest')
                ? 'Содержимое набора изменилось без новой версии. Обновите приложение: повторная загрузка этой версии не поможет.'
                : 'Набор не установлен: загрузка или проверка не завершена.'
              : null,
        },
        {
          cancel: async () => {
            this.cancel(task.id);
            const result = await this.wait(task.id);
            if (result.state === 'failed') throw new Error('Не удалось завершить отмену набора.');
          },
          retry: async () => {
            const retried = this.retry(task.id);
            const result = await this.wait(retried.id);
            if (result.state === 'failed') throw new Error('Набор не удалось установить.');
          },
        },
      );
    });
    window.addEventListener('online', this.handleOnline);
    recoverPendingModuleInstalls(
      this,
      catalog,
      new Set(this.listInstalled().map((module) => module.moduleId)),
    );
    const queue = getDownloadQueue();
    for (const task of queue
      .list()
      .filter((item) => item.kind === 'module' && item.state === 'interrupted')) {
      const module = catalog.modules.find(
        (item) => `module:${item.id}@${item.version}` === task.id && isModuleReleased(item),
      );
      if (!module) {
        queue.rejectRestoration(task.id);
        continue;
      }
      if (this.registry.get(module.id)?.version === module.version) {
        queue.observe(
          { id: task.id, kind: 'module', title: module.title },
          { state: 'completed', errorMessage: null },
          {},
        );
      } else {
        queue.setRestorer(task.id, async () => {
          const next = this.install(module);
          return this.wait(next.id);
        });
      }
    }
    this.reconcileAssessmentDependencies();
    this.localPackagedModulesReady = this.ensureLocalPackagedModules();
  }

  public whenLocalPackagedModulesReady(): Promise<void> {
    return this.localPackagedModulesReady;
  }

  private async probeArtifactRange(url: string): Promise<boolean> {
    const probe = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    return probe.ok || probe.status === 206;
  }

  private async localArtifactReachable(url: string): Promise<boolean> {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (head.ok) return true;
      if (head.status === 404 || head.status === 410) return false;
    } catch {
      // Some hosts reject HEAD; a ranged GET still proves the artifact is there.
    }
    try {
      return await this.probeArtifactRange(url);
    } catch {
      return false;
    }
  }

  private async ensureLocalPackagedModules(): Promise<void> {
    const candidates = localPackagedModulesToInstall(
      this.catalog,
      new Map(this.listInstalled().map((module) => [module.moduleId, module])),
    );
    await Promise.all(
      candidates.map(async (module) => {
        if (this.disposed) return;
        const artifact = module.artifacts.find((entry) => entry.kind === 'index' && entry.url);
        if (!artifact?.url) return;
        const reachable = await this.localArtifactReachable(
          resolveContentModuleArtifactUrl(artifact.url),
        );
        if (!reachable || this.disposed) return;
        const installed = this.listInstalled().find((entry) => entry.moduleId === module.id);
        if (!contentModuleNeedsInstall(module, installed)) return;
        try {
          const task = this.install(module);
          await this.wait(task.id);
        } catch (cause) {
          console.warn(`Local packaged module ${module.id} could not be installed.`, cause);
        }
      }),
    );
  }

  private retryKey(moduleId: string, version: string): string {
    return `${moduleId}@${version}`;
  }

  private activeModuleVersion(moduleId: string): string | null {
    return this.registry.get(moduleId)?.version ?? null;
  }

  private invalidateAssessmentDependencyScans(moduleId: string): number {
    const generation = (this.assessmentDependencyGenerations.get(moduleId) ?? 0) + 1;
    this.assessmentDependencyGenerations.set(moduleId, generation);
    const prefix = `${moduleId}@`;
    for (const key of this.assessmentDependencyScans.keys()) {
      if (key.startsWith(prefix)) this.assessmentDependencyScans.delete(key);
    }
    return generation;
  }

  private isCurrentAssessmentDependencyScan(
    moduleId: string,
    version: string,
    generation: number,
  ): boolean {
    return (
      !this.disposed &&
      this.assessmentDependencyGenerations.get(moduleId) === generation &&
      this.activeModuleVersion(moduleId) === version
    );
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
      if (!module || !isModuleReleased(module)) {
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
    const state = pruneAssessmentModuleDependencies(installed, getAssessmentCatalog());
    for (const [moduleId, version] of installed) {
      const descriptor = this.catalog.modules.find(
        (module) => module.id === moduleId && module.version === version,
      );
      if (descriptor?.kind !== 'clinical') {
        this.invalidateAssessmentDependencyScans(moduleId);
        removeAssessmentModuleDependencies(moduleId, getAssessmentCatalog());
        continue;
      }
      if (state.moduleDependencies[moduleId]?.version === version) continue;
      void this.syncAssessmentDependencies(moduleId, version).catch((cause: unknown) => {
        console.warn(`Unable to reconcile questionnaire dependencies for ${moduleId}.`, cause);
      });
    }
  }

  private syncAssessmentDependencies(moduleId: string, version: string): Promise<void> {
    if (this.disposed || this.activeModuleVersion(moduleId) !== version) return Promise.resolve();
    const key = this.retryKey(moduleId, version);
    const existing = this.assessmentDependencyScans.get(key);
    if (existing) return existing;
    const generation = this.invalidateAssessmentDependencyScans(moduleId);
    const scan = this.scanAssessmentDependencies(moduleId, version, generation);
    this.assessmentDependencyScans.set(key, scan);
    const cleanup = (): void => {
      if (this.assessmentDependencyScans.get(key) === scan) {
        this.assessmentDependencyScans.delete(key);
      }
    };
    scan.then(cleanup, cleanup);
    return scan;
  }

  private async scanAssessmentDependencies(
    moduleId: string,
    version: string,
    generation: number,
  ): Promise<void> {
    const descriptor = this.catalog.modules.find(
      (module) => module.id === moduleId && module.version === version,
    );
    if (descriptor?.kind !== 'clinical') {
      if (this.isCurrentAssessmentDependencyScan(moduleId, version, generation)) {
        removeAssessmentModuleDependencies(moduleId, getAssessmentCatalog());
      }
      return;
    }
    const bytes = await this.backend.readIndexBytes(moduleId, version);
    if (!bytes) {
      if (this.isCurrentAssessmentDependencyScan(moduleId, version, generation)) {
        removeAssessmentModuleDependencies(moduleId, getAssessmentCatalog());
      }
      return;
    }
    let store: SqliteMedicalStore | null = null;
    try {
      store = await SqliteMedicalStore.createFromBytes(bytes);
      await store.initialize();
      const assessmentIds = await findAssessmentDependenciesInStore(store);
      if (!this.isCurrentAssessmentDependencyScan(moduleId, version, generation)) return;
      if (assessmentIds.length > 0) {
        await preloadAssessmentDefinitions(assessmentIds).catch((cause: unknown) => {
          console.warn(`Unable to preload questionnaires required by ${moduleId}.`, cause);
        });
      }
      if (!this.isCurrentAssessmentDependencyScan(moduleId, version, generation)) return;
      setAssessmentModuleDependencies(moduleId, version, assessmentIds, getAssessmentCatalog());
    } finally {
      await store?.close().catch(() => undefined);
    }
  }

  private restoreAssessmentDependencyScan(moduleId: string): void {
    const installed = this.registry.get(moduleId);
    if (!installed) return;
    void this.syncAssessmentDependencies(moduleId, installed.version).catch((cause: unknown) => {
      console.warn(`Unable to restore questionnaire dependencies for ${moduleId}.`, cause);
    });
  }

  public listInstalled(): readonly InstalledContentModule[] {
    return this.registry.list().filter((module) => module.moduleId !== CORE_MODULE_ID);
  }

  public listTasks(): readonly ContentModuleDownloadTask[] {
    return this.installer.listTasks();
  }

  public async listInstalledToolDefinitions(): Promise<readonly ToolDefinitionRecord[]> {
    const definitions: ToolDefinitionRecord[] = [];
    for (const installed of this.listInstalled()) {
      const descriptor = this.catalog.modules.find(
        (module) => module.id === installed.moduleId && module.version === installed.version,
      );
      if (descriptor?.kind !== 'tool') continue;
      const bytes = await this.backend.readIndexBytes(installed.moduleId, installed.version);
      if (!bytes)
        throw new Error(`Установленный модуль инструментов потерян: ${installed.moduleId}.`);
      const store = await SqliteMedicalStore.createFromBytes(bytes);
      try {
        await store.initialize();
        definitions.push(...(await store.listToolDefinitions()));
      } finally {
        await store.close();
      }
    }
    return definitions;
  }

  public subscribe(listener: (task: ContentModuleDownloadTask) => void): () => void {
    return this.installer.subscribe(listener);
  }

  public install(module: ContentModuleCatalogEntry): ContentModuleDownloadTask {
    const current = this.catalog.modules.find(
      (candidate) => candidate.id === module.id && candidate.version === module.version,
    );
    if (!current || !isModuleReleased(current)) {
      throw new Error(`Набор ${module.id}@${module.version} пока недоступен для скачивания.`);
    }
    module = current;
    this.clearRetry(module.id, module.version);
    const includeSourceAssets = module.artifacts.some(
      (artifact) => artifact.kind === 'source-assets',
    );
    enqueuePendingModuleInstall(module.id, module.version, includeSourceAssets);
    try {
      return this.installer.install({
        moduleId: module.id,
        version: module.version,
        includeSourceAssets,
      });
    } catch (cause) {
      // Compatibility/dependency checks are synchronous too. Do not poison future boots with a
      // durable entry that the installer never accepted.
      discardPendingModuleInstall(module.id, module.version);
      throw cause;
    }
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
      if (retried.has(key)) continue;
      retried.add(key);
      if (task.state !== 'failed') continue;
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
    this.disposed = true;
    this.cancelAll();
    for (const timer of this.retryTimers.values()) window.clearTimeout(timer);
    this.retryTimers.clear();
    for (const module of this.listInstalled()) {
      this.invalidateAssessmentDependencyScans(module.moduleId);
    }
    this.assessmentDependencyScans.clear();
    window.removeEventListener('online', this.handleOnline);
  }

  public async remove(moduleId: string): Promise<void> {
    this.invalidateAssessmentDependencyScans(moduleId);
    try {
      await commitRegistryAndArtifactMutation(
        this.registry,
        () => this.registry.remove(moduleId),
        () => this.backend.remove(moduleId),
      );
      removeAssessmentModuleDependencies(moduleId, getAssessmentCatalog());
    } catch (cause) {
      this.restoreAssessmentDependencyScan(moduleId);
      throw cause;
    }
  }

  public async rollback(moduleId: string, version?: string): Promise<InstalledContentModule> {
    this.invalidateAssessmentDependencyScans(moduleId);
    let installed: InstalledContentModule;
    try {
      installed = await commitRegistryAndArtifactMutation(
        this.registry,
        () => this.registry.rollback(moduleId, version),
        (next) => this.backend.setActive(moduleId, next.version),
      );
    } catch (cause) {
      this.restoreAssessmentDependencyScan(moduleId);
      throw cause;
    }

    try {
      await this.syncAssessmentDependencies(moduleId, installed.version);
    } catch (cause) {
      this.invalidateAssessmentDependencyScans(moduleId);
      removeAssessmentModuleDependencies(moduleId, getAssessmentCatalog());
      console.warn(
        `Unable to resolve questionnaire dependencies after rolling back ${moduleId}.`,
        cause,
      );
      this.restoreAssessmentDependencyScan(moduleId);
    }
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
        const store = await openModuleStore(
          pointer.moduleId,
          pointer.version,
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
