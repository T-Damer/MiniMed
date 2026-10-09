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
  hasAssessmentPayload,
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
import { canStreamEncodedIndex } from '@/features/modules/encoded-index-reader';
import {
  markInstallState,
  recordInstallDuration,
  timeInstallPhase,
} from '@/features/modules/install-timing';
import {
  contentModuleNeedsInstall,
  isModuleReleased,
  localPackagedModulesToInstall,
} from '@/features/modules/local-packaged-modules';
import { BUNDLED_CORE_MODULE } from '@/features/modules/module-catalog-shell';
import { decodeModuleIndex } from '@/features/modules/module-index-compression';
import {
  type ModuleIndexPayload,
  moduleIndexBlob,
  moduleIndexBytes,
  moduleIndexSize,
} from '@/features/modules/module-index-payload';
import {
  holdModuleStagingLock,
  listModulePools,
  MODULE_POOL_PREFIX,
  type ModulePoolSweep,
  moduleOpfsPoolName,
  moduleVersionKey,
  removeModulePoolWhenFree,
  sweepModulePools,
} from '@/features/modules/module-opfs-pools';
import { commitRegistryAndArtifactMutation } from '@/features/modules/module-registry-transaction';
import { searchIndexIsConsistent } from '@/features/modules/module-search-index';
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
  readonly definitionReference?: ContentModuleCatalogEntry['definitionReference'];
  readonly key: string;
  readonly moduleId: string;
  readonly version: string;
  /**
   * The index of a small module. Absent once a large index lives only in OPFS (`indexStorage`):
   * rows written before the single-store change still carry the bytes next to an OPFS copy and are
   * migrated by dropping them (see `dropRedundantIndexBytes`).
   */
  readonly bytes?: ArrayBuffer | Blob;
  readonly indexStorage?: 'opfs';
  readonly indexSizeBytes?: number;
  readonly indexSha256?: string;
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
  /** Decoded bytes; absent when a large index was streamed straight into OPFS. */
  readonly bytes?: Uint8Array;
  /** Decoded size of an index that already sits in `opfsPool`. */
  readonly opfsBytes?: number;
  readonly opfsPool?: string;
  /** Keeps orphan sweeps away from the pool until the version is committed or discarded. */
  readonly releaseStaging?: () => void;
  committed?: boolean;
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

const versionKey = moduleVersionKey;

/** An index already imported into OPFS (nothing to copy), identified by its decoded size. */
interface InstalledOpfsIndex {
  readonly opfsBytes: number;
}
type ModuleIndexSource = ModuleIndexPayload | InstalledOpfsIndex;

function isInstalledOpfsIndex(source: ModuleIndexSource): source is InstalledOpfsIndex {
  return typeof source === 'object' && source !== null && 'opfsBytes' in source;
}

/** Large indexes live in OPFS only; small ones stay in IndexedDB and are opened in memory. */
function isLargeIndex(sizeBytes: number): boolean {
  return sizeBytes > SQLITE_WASM_DESERIALIZE_MAX_BYTES;
}

function storedIndexSource(stored: StoredModuleVersion): ModuleIndexSource | null {
  if (stored.bytes) return stored.bytes;
  if (stored.indexStorage === 'opfs' && stored.indexSizeBytes !== undefined) {
    return { opfsBytes: stored.indexSizeBytes };
  }
  return null;
}

async function openModuleStore(
  moduleId: string,
  version: string,
  source: ModuleIndexSource,
  indexSha256?: string,
): Promise<SqliteMedicalStore | WorkerOpfsMedicalStore> {
  if (!isInstalledOpfsIndex(source) && !isLargeIndex(moduleIndexSize(source))) {
    return SqliteMedicalStore.createFromBytes(await moduleIndexBytes(source));
  }

  if (indexSha256 !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(indexSha256)) {
    throw new Error('Invalid module index checksum.');
  }
  const key = moduleOpfsPoolName(moduleId, version, indexSha256);
  if (isInstalledOpfsIndex(source)) {
    return WorkerOpfsMedicalStore.open({
      installed: { byteLength: source.opfsBytes },
      databaseName: `${key}.db`,
      fetchTimeoutMs: MODULE_OPFS_FETCH_TIMEOUT_MS,
      poolName: key,
    });
  }
  // The OPFS pool is the module's only copy: a missing file is imported from the payload once, an
  // existing one is reused. The caller drops any IndexedDB duplicate after a successful open.
  const url = URL.createObjectURL(moduleIndexBlob(source));
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

async function readVersionKeys(database: IDBDatabase): Promise<readonly string[]> {
  const transaction = database.transaction(VERSIONS_STORE, 'readonly');
  const keys = await requestResult(transaction.objectStore(VERSIONS_STORE).getAllKeys());
  await transactionDone(transaction);
  return keys.map(String);
}

/**
 * Single store: once a large index is in OPFS, the IndexedDB row keeps only its metadata. The row
 * is rewritten inside one transaction, and only if it still holds the duplicate bytes.
 */
async function dropRedundantIndexBytes(database: IDBDatabase, key: string): Promise<boolean> {
  const transaction = database.transaction(VERSIONS_STORE, 'readwrite');
  const store = transaction.objectStore(VERSIONS_STORE);
  const row = await requestResult(store.get(key) as IDBRequest<StoredModuleVersion | undefined>);
  const size = row?.bytes ? moduleIndexSize(row.bytes) : 0;
  if (!row || !isLargeIndex(size)) {
    transaction.abort();
    await transactionDone(transaction).catch(() => undefined);
    return false;
  }
  const { bytes: _duplicate, ...metadata } = row;
  store.put({ ...metadata, indexStorage: 'opfs', indexSizeBytes: size });
  await transactionDone(transaction);
  return true;
}

/**
 * Pool names the stored versions refer to. Row keys are enough: a pool is named after its
 * `moduleId@version`, optionally followed by the index checksum.
 */
function referencedPoolPrefixes(keys: readonly string[]): readonly string[] {
  return keys.map((key) => `${MODULE_POOL_PREFIX}${encodeURIComponent(key)}`);
}

function poolBelongsToVersion(pool: string, prefix: string): boolean {
  return pool === prefix || pool.startsWith(`${prefix}${encodeURIComponent(':')}`);
}

/** Removes OPFS pools that no stored module version refers to; a pool in use is left for later. */
export async function sweepOrphanedModulePools(): Promise<ModulePoolSweep | null> {
  if (!('indexedDB' in globalThis)) return null;
  const database = await openDatabase();
  let prefixes: readonly string[];
  try {
    prefixes = referencedPoolPrefixes(await readVersionKeys(database));
  } finally {
    database.close();
  }
  const referenced = new Set(
    (await listModulePools()).filter((pool) =>
      prefixes.some((prefix) => poolBelongsToVersion(pool, prefix)),
    ),
  );
  return sweepModulePools(referenced);
}

/**
 * Versions that are not active are never mounted, so earlier app versions left their IndexedDB
 * copy next to the OPFS one. Make sure the OPFS copy exists and drop the duplicate.
 */
export async function migrateInactiveModuleCopies(
  largeModuleIds: ReadonlySet<string>,
): Promise<number> {
  if (!('indexedDB' in globalThis) || largeModuleIds.size === 0) return 0;
  const database = await openDatabase();
  let migrated = 0;
  try {
    const active = new Set(
      (await readActivePointers(database)).map((pointer) =>
        versionKey(pointer.moduleId, pointer.version),
      ),
    );
    for (const key of await readVersionKeys(database)) {
      const moduleId = key.slice(0, key.lastIndexOf('@'));
      if (active.has(key) || !largeModuleIds.has(moduleId)) continue;
      const row = await readVersion(database, moduleId, key.slice(moduleId.length + 1));
      if (!row?.bytes || !isLargeIndex(moduleIndexSize(row.bytes))) continue;
      const store = await openModuleStore(row.moduleId, row.version, row.bytes, row.indexSha256);
      await store.close();
      if (await dropRedundantIndexBytes(database, key)) migrated += 1;
    }
  } finally {
    database.close();
  }
  return migrated;
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
      !(
        artifact.kind === 'index' &&
        (artifact.compression === 'gzip' || artifact.compression === 'zstd')
      ) &&
      !(artifact.kind === 'source-assets' && artifact.compression === 'zip')
    ) {
      throw new Error('Поддерживаются SQLite, gzip и zstd для SQLite и ZIP для изображений.');
    }
    const resolvedUrl = resolveContentModuleArtifactUrl(artifact.url);
    const cacheKey = artifact.sha256 ?? `${artifact.id}:${resolvedUrl}`;
    return timeInstallPhase(
      'download',
      () =>
        downloadWithRetry({
          ...(module
            ? { jobId: `module:${module.id}@${module.version}`, trackProgress: false }
            : {}),
          url: resolvedUrl,
          cacheKey,
          expectedBytes: artifact.sizeBytes,
          signal,
          retryDelaysMs: MODULE_RETRY_DELAYS_MS,
          retryMissingAssets: false,
          onProgress: ({ downloadedBytes, totalBytes }) =>
            onProgress({ downloadedBytes, totalBytes }),
        }),
      { artifactId: artifact.id, bytes: artifact.sizeBytes },
    );
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
    // A large index reaches OPFS while it is validated and is committed only by `activate`: keep
    // orphan sweeps away in between.
    const large = artifact.kind === 'index' && isLargeIndex(bytes.byteLength);
    const releaseStaging = large ? await holdModuleStagingLock() : undefined;
    const indexSha256 = artifact.compression === 'none' ? artifact.sha256 : artifact.decodedSha256;
    this.staged.set(token, {
      moduleId: module.id,
      version: module.version,
      artifact,
      bytes,
      ...(large
        ? { opfsPool: moduleOpfsPoolName(module.id, module.version, indexSha256 ?? undefined) }
        : {}),
      ...(releaseStaging ? { releaseStaging } : {}),
    });
    return {
      artifactId: artifact.id,
      kind: artifact.kind,
      sizeBytes: bytes.byteLength,
      token,
    };
  }

  /**
   * A large zstd index is decoded frame by frame straight into its OPFS pool and verified against
   * the catalog's decoded size and SHA-256 on the way: neither the decoded file nor a second copy
   * of it ever exists in memory or IndexedDB. Anything else takes the generic decode path.
   */
  public stageEncodedIndex(
    module: ContentModuleCatalogEntry,
    artifact: ModuleArtifact,
    encoded: Uint8Array,
    signal: AbortSignal,
  ): Promise<StagedContentModuleArtifact | null> {
    return timeInstallPhase('stage-encoded', () =>
      this.stageEncodedIndexTimed(module, artifact, encoded, signal),
    );
  }

  private async stageEncodedIndexTimed(
    module: ContentModuleCatalogEntry,
    artifact: ModuleArtifact,
    encoded: Uint8Array,
    signal: AbortSignal,
  ): Promise<StagedContentModuleArtifact | null> {
    const { decodedSizeBytes, decodedSha256 } = artifact;
    if (
      artifact.kind !== 'index' ||
      artifact.compression !== 'zstd' ||
      !decodedSizeBytes ||
      !decodedSha256 ||
      !isLargeIndex(decodedSizeBytes) ||
      typeof Worker === 'undefined' ||
      !canStreamEncodedIndex(encoded)
    ) {
      return null;
    }
    signal.throwIfAborted();
    const token = `${module.id}@${module.version}:${artifact.id}`;
    const opfsPool = moduleOpfsPoolName(module.id, module.version, decodedSha256);
    const releaseStaging = await holdModuleStagingLock();
    const staged: StagedBytes = {
      moduleId: module.id,
      version: module.version,
      artifact,
      opfsBytes: decodedSizeBytes,
      opfsPool,
      releaseStaging,
    };
    this.staged.set(token, staged);
    try {
      const store = await WorkerOpfsMedicalStore.open({
        encoded: { bytes: encoded, decodedSizeBytes, decodedSha256 },
        databaseName: `${opfsPool}.db`,
        fetchTimeoutMs: MODULE_OPFS_FETCH_TIMEOUT_MS,
        poolName: opfsPool,
      });
      await timeInstallPhase('stage-close', () => store.close());
      signal.throwIfAborted();
    } catch (cause) {
      await this.discardStaging(module.id, module.version);
      throw cause;
    }
    return { artifactId: artifact.id, kind: artifact.kind, sizeBytes: decodedSizeBytes, token };
  }

  public activate(
    module: ContentModuleCatalogEntry,
    artifacts: readonly StagedContentModuleArtifact[],
  ) {
    return timeInstallPhase('activate', () => this.activateTimed(module, artifacts));
  }

  private async activateTimed(
    module: ContentModuleCatalogEntry,
    artifacts: readonly StagedContentModuleArtifact[],
  ) {
    const index = artifacts.find((artifact) => artifact.kind === 'index');
    if (!index) throw new Error('В наборе нет поисковой базы.');
    const staged = this.staged.get(index.token);
    if (!staged) throw new Error('Временный файл набора потерян.');
    const decodedSize = staged.opfsBytes ?? staged.bytes?.byteLength;
    if (decodedSize === undefined) throw new Error('Временный файл набора потерян.');
    const largeIndex = isLargeIndex(decodedSize);
    const indexSha256 =
      staged.artifact.compression === 'none'
        ? staged.artifact.sha256
        : staged.artifact.decodedSha256;
    if (largeIndex && staged.bytes) {
      // The validator normally imported it already; make sure the OPFS copy, now the one durable
      // copy, exists. Opening it as installed reads nothing, so no second Blob of the index is made.
      const checksum = indexSha256 ?? undefined;
      let store: SqliteMedicalStore | WorkerOpfsMedicalStore;
      try {
        store = await openModuleStore(
          module.id,
          module.version,
          { opfsBytes: decodedSize },
          checksum,
        );
      } catch (cause) {
        if (!(cause instanceof Error) || !/missing from OPFS/u.test(cause.message)) throw cause;
        store = await openModuleStore(module.id, module.version, staged.bytes, checksum);
      }
      await store.close();
    }
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
        if (source.artifact.compression !== 'zip' || !source.bytes) {
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
      const stored: StoredModuleVersion = {
        key: versionKey(module.id, module.version),
        ...(module.definitionReference ? { definitionReference: module.definitionReference } : {}),
        moduleId: module.id,
        version: module.version,
        ...(largeIndex || !staged.bytes
          ? { indexStorage: 'opfs' as const, indexSizeBytes: decodedSize }
          : { bytes: moduleIndexBlob(staged.bytes) }),
        ...(indexSha256 ? { indexSha256 } : {}),
        ...(sourceAssets.length > 0 ? { sourceAssets } : {}),
        sourceSetDigest: module.sourceSetDigest ?? '',
        installedAt: new Date().toISOString(),
      };
      transaction.objectStore(VERSIONS_STORE).put(stored);
      transaction.objectStore(ACTIVE_STORE).put({ moduleId: module.id, version: module.version });
      await transactionDone(transaction);
      staged.committed = true;
      await this.discardStaging(module.id, module.version);
      return {
        moduleId: module.id,
        version: module.version,
        installedSizeBytes:
          decodedSize +
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
    const abandoned: StagedBytes[] = [];
    for (const [token, staged] of this.staged) {
      if (staged.moduleId !== moduleId || staged.version !== version) continue;
      this.staged.delete(token);
      if (staged.opfsPool && !staged.committed) abandoned.push(staged);
      else staged.releaseStaging?.();
    }
    // An index that reached OPFS but was never committed has no row: drop its pool, unless a row
    // of the same version (an earlier, valid installation) is using it.
    for (const staged of abandoned) {
      try {
        if (!(await this.hasStoredVersion(moduleId, version))) {
          await removeModulePoolWhenFree(staged.opfsPool ?? '');
        }
      } finally {
        staged.releaseStaging?.();
      }
    }
  }

  private async hasStoredVersion(moduleId: string, version: string): Promise<boolean> {
    const database = await openDatabase();
    try {
      return (await readVersion(database, moduleId, version)) !== null;
    } finally {
      database.close();
    }
  }

  /** The in-memory index of a small module; null for a missing version or an OPFS-only index. */
  public async readIndexBytes(moduleId: string, version: string): Promise<Uint8Array | null> {
    const database = await openDatabase();
    try {
      const stored = await readVersion(database, moduleId, version);
      return stored?.bytes ? await moduleIndexBytes(stored.bytes) : null;
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
    // The OPFS pools of the removed versions are orphans now. One that a search worker still has
    // open stays until a later sweep (every core connection and app start runs one).
    await sweepOrphanedModulePools().catch((cause: unknown) => {
      console.warn(`Unable to clean the OPFS pools of ${moduleId}.`, cause);
    });
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
  public validate(module: ContentModuleCatalogEntry, indexBytes: Uint8Array | null) {
    return timeInstallPhase('validate', () => this.validateTimed(module, indexBytes));
  }

  private async validateTimed(module: ContentModuleCatalogEntry, indexBytes: Uint8Array | null) {
    let store: SqliteMedicalStore | WorkerOpfsMedicalStore | null = null;
    try {
      const artifact = module.artifacts.find((entry) => entry.kind === 'index');
      const indexSha256 =
        (artifact?.compression === 'none' ? artifact.sha256 : artifact?.decodedSha256) ?? undefined;
      if (indexBytes === null) {
        // Streamed into OPFS by the backend: open that copy, never import another.
        if (!artifact?.decodedSizeBytes) throw new Error('Для базы не указан размер распаковки.');
        const opfsBytes = artifact.decodedSizeBytes;
        store = await timeInstallPhase('validate-open', () =>
          openModuleStore(module.id, module.version, { opfsBytes }, indexSha256),
        );
      } else {
        const bytes = indexBytes;
        store = await timeInstallPhase('validate-open', () =>
          openModuleStore(module.id, module.version, bytes, indexSha256),
        );
      }
      const opened = store;
      const health = await timeInstallPhase('validate-initialize', () => opened.initialize());
      // The installer verified the SHA-256 of these exact bytes, so a large pack skips the
      // whole-file page walk (80-200 s through OPFS handles for a 630 MB module).
      const scan = isLargeIndex(artifact?.decodedSizeBytes ?? indexBytes?.byteLength ?? 0)
        ? 'sampled'
        : 'full';
      const integrityStartedAt = performance.now();
      const integrity = await timeInstallPhase('validate-integrity', () =>
        opened.inspectIntegrity(scan),
      );
      for (const [check, durationMs] of Object.entries(integrity.timingsMs ?? {})) {
        recordInstallDuration(`validate-integrity:${check}`, integrityStartedAt, durationMs);
      }
      const schemaCompatible = health.schemaVersion === module.compatibility.schemaVersion;
      let referenceValid = false;
      if (module.definitionReference) {
        const reference = await store.reference({
          op: 'status',
          moduleId: module.id,
          editionId: module.definitionReference.editionId,
        });
        referenceValid =
          reference.op === 'status' &&
          reference.entries === module.definitionReference.entries &&
          health.contentPackIds.length === 1 &&
          health.contentPackIds[0] === module.definitionReference.editionId;
      }
      const valid =
        integrity.integrity === 'ok' &&
        integrity.foreignKeyViolations === 0 &&
        (module.definitionReference
          ? referenceValid
          : searchIndexIsConsistent({
              searchable: module.capabilities.search,
              chunkCount: integrity.chunkCount,
              ftsRowCount: integrity.ftsRowCount,
            })) &&
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
      const closing = store;
      if (closing) {
        await timeInstallPhase('validate-close', () => closing.close()).catch(() => undefined);
      }
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
      {
        appVersion: RELEASE_VERSION,
        schemaVersion: 2,
        coreCatalogVersion: '1',
        definitionReferenceSchemaVersions: [7],
      },
      new BrowserModuleDownloader(),
      this.backend,
      new BrowserModuleValidator(),
      this.registry,
      3,
      decodeModuleIndex,
    );
    this.installer.subscribe((task) => {
      if (task.state !== 'downloading') markInstallState(task.moduleId, task.state);
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
    void this.reconcileStoredIndexes();
  }

  /**
   * One store per large index: older app versions kept an IndexedDB copy next to the OPFS one and
   * never removed OPFS pools. Idle work, safe to repeat, and never allowed to fail the app.
   */
  private async reconcileStoredIndexes(): Promise<void> {
    const largeModuleIds = new Set(
      this.catalog.modules
        .filter((module) =>
          module.artifacts.some(
            (artifact) =>
              artifact.kind === 'index' &&
              isLargeIndex(artifact.decodedSizeBytes ?? artifact.sizeBytes ?? 0),
          ),
        )
        .map((module) => module.id),
    );
    try {
      await migrateInactiveModuleCopies(largeModuleIds);
      await sweepOrphanedModulePools();
    } catch (cause) {
      console.warn('Unable to reconcile stored module indexes.', cause);
    }
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
      const assessmentIds = await findAssessmentDependenciesInStore(store, {
        modules: this.catalog.modules,
      });
      if (!this.isCurrentAssessmentDependencyScan(moduleId, version, generation)) return;
      // A questionnaire that is not downloaded yet stays a recorded dependency: there is nothing to
      // warm, and its absence is not a failure worth a console warning.
      const installedAssessmentIds = assessmentIds.filter(hasAssessmentPayload);
      if (installedAssessmentIds.length > 0) {
        await preloadAssessmentDefinitions(installedAssessmentIds).catch((cause: unknown) => {
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
      this.scheduleOrphanSweep();
    } catch (cause) {
      this.restoreAssessmentDependencyScan(moduleId);
      throw cause;
    }
  }

  /**
   * A removed module's pool may still be open in the live search core until the app reconnects its
   * content. Look again a little later, a bounded number of times.
   */
  private scheduleOrphanSweep(attempt = 0): void {
    const delays = [3_000, 15_000, 60_000];
    const delay = delays[attempt];
    if (this.disposed || delay === undefined) return;
    window.setTimeout(() => {
      void sweepOrphanedModulePools()
        .then((result) => {
          if (result && (result.busy.length > 0 || result.deferred)) {
            this.scheduleOrphanSweep(attempt + 1);
          }
        })
        .catch((cause: unknown) => {
          console.warn('Unable to sweep orphaned OPFS module pools.', cause);
        });
    }, delay);
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
      const source = storedIndexSource(stored);
      if (!source) {
        console.warn(`Content module ${pointer.moduleId} has no stored index.`);
        continue;
      }
      try {
        const store = await openModuleStore(
          pointer.moduleId,
          pointer.version,
          source,
          stored.indexSha256,
        );
        if (stored.definitionReference) {
          await store.initialize();
          try {
            const status = await store.reference({
              op: 'status',
              moduleId: pointer.moduleId,
              editionId: stored.definitionReference.editionId,
            });
            if (status.op !== 'status' || status.entries !== stored.definitionReference.entries)
              throw new Error('Installed reference descriptor mismatch.');
          } catch (cause) {
            await store.close();
            throw cause;
          }
        }
        mounts.push({
          moduleId: pointer.moduleId,
          store,
          enabled: true,
          searchWeight: 1,
          ...(stored.definitionReference
            ? { definitionReference: stored.definitionReference }
            : {}),
        });
        if (stored.bytes && isLargeIndex(moduleIndexSize(stored.bytes))) {
          // Installed before the single-store change: the OPFS copy just opened is the module now.
          await dropRedundantIndexBytes(database, stored.key).catch((cause: unknown) => {
            console.warn(`Unable to drop the duplicate index of ${pointer.moduleId}.`, cause);
          });
        }
      } catch (cause) {
        console.warn(`Unable to mount content module ${pointer.moduleId}.`, cause);
      }
    }
    return mounts;
  } finally {
    database.close();
    void sweepOrphanedModulePools().catch((cause: unknown) => {
      console.warn('Unable to sweep orphaned OPFS module pools.', cause);
    });
  }
}
