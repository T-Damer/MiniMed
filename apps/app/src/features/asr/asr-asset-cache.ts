import {
  ASR_DOWNLOAD_VERSION,
  ASR_MODEL_REVISIONS,
  type SupportedAsrModelId,
} from '@/features/asr/asr-download-protocol';

const DATABASE_NAME = 'minimed-asr-asset-cache-v1';
const DATABASE_VERSION = 1;
const ASSET_STORE = 'assets';
const MANIFEST_STORE = 'models';

interface CachedAsrAsset {
  readonly key: string;
  readonly modelId: SupportedAsrModelId;
  readonly revision: string;
  readonly url: string;
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly byteLength: number | null;
  readonly admitted: boolean;
  readonly sha256?: string;
  readonly data?: Blob;
  readonly updatedAt: string;
}

export interface AsrAssetRequirement {
  readonly url: string;
  readonly needsBytes: boolean;
}

interface CachedAsrModelManifest {
  readonly modelId: SupportedAsrModelId;
  readonly revision: string;
  readonly version: string;
  readonly requirements: readonly AsrAssetRequirement[];
  readonly updatedAt: string;
}

export interface CachedAsrAssetMetadata {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly byteLength: number | null;
  readonly hasBytes: boolean;
}

export interface CachedAsrAssetBytes extends CachedAsrAssetMetadata {
  readonly bytes: Uint8Array;
}

function hasIndexedDb(): boolean {
  return typeof globalThis.indexedDB?.open === 'function';
}

function cacheKey(url: string): string {
  return `${ASR_DOWNLOAD_VERSION}:${url}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось прочитать кэш речевой модели.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Не удалось обновить кэш речевой модели.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Обновление кэша речевой модели отменено.'));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(MANIFEST_STORE)) {
        database.createObjectStore(MANIFEST_STORE, { keyPath: 'modelId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть кэш речевой модели.'));
  });
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = Uint8Array.from(bytes);
  return copy.buffer;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ownedBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function normalizedHeaders(
  headers: readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] {
  return headers
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .filter(([key]) => ['content-type', 'content-length', 'content-range'].includes(key));
}

function contentTypeForUrl(url: string): string {
  if (/\.json(?:$|\?)/u.test(url)) return 'application/json';
  if (/\.(?:txt|jsonl)(?:$|\?)/u.test(url)) return 'text/plain;charset=utf-8';
  return 'application/octet-stream';
}

function validRecord(record: CachedAsrAsset, modelId: SupportedAsrModelId, url: string): boolean {
  return (
    record.modelId === modelId &&
    record.url === url &&
    record.revision === ASR_MODEL_REVISIONS[modelId] &&
    record.key === cacheKey(url)
  );
}

async function loadRecord(
  modelId: SupportedAsrModelId,
  url: string,
): Promise<CachedAsrAsset | null> {
  if (!hasIndexedDb()) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readonly');
    const record = await requestResult(
      transaction.objectStore(ASSET_STORE).get(cacheKey(url)) as IDBRequest<
        CachedAsrAsset | undefined
      >,
    );
    await transactionDone(transaction);
    return record && validRecord(record, modelId, url) ? record : null;
  } finally {
    database.close();
  }
}

async function deleteRecord(url: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    transaction.objectStore(ASSET_STORE).delete(cacheKey(url));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function inspectCachedAsrAsset(
  modelId: SupportedAsrModelId,
  url: string,
): Promise<CachedAsrAssetMetadata | null> {
  const record = await loadRecord(modelId, url);
  if (!record?.admitted) return null;
  return {
    status: record.status,
    headers: record.headers,
    byteLength: record.byteLength,
    hasBytes: Boolean(record.data && record.sha256),
  };
}

export async function readCachedAsrAsset(
  modelId: SupportedAsrModelId,
  url: string,
): Promise<CachedAsrAssetBytes | null> {
  const record = await loadRecord(modelId, url);
  if (!record?.admitted || !record.data || !record.sha256) return null;
  if (record.byteLength !== record.data.size) {
    await deleteRecord(url);
    return null;
  }
  const bytes = new Uint8Array(await record.data.arrayBuffer());
  if ((await sha256(bytes)) !== record.sha256) {
    await deleteRecord(url);
    return null;
  }
  return {
    status: record.status,
    headers: record.headers,
    byteLength: bytes.byteLength,
    hasBytes: true,
    bytes,
  };
}

export async function storeAsrAssetMetadata(input: {
  readonly modelId: SupportedAsrModelId;
  readonly url: string;
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
}): Promise<void> {
  if (!hasIndexedDb()) return;
  const previous = await loadRecord(input.modelId, input.url);
  const record: CachedAsrAsset = {
    key: cacheKey(input.url),
    modelId: input.modelId,
    revision: ASR_MODEL_REVISIONS[input.modelId],
    url: input.url,
    status: input.status,
    headers: normalizedHeaders(input.headers),
    byteLength: previous?.byteLength ?? null,
    admitted: previous?.admitted ?? false,
    ...(previous?.sha256 ? { sha256: previous.sha256 } : {}),
    ...(previous?.data ? { data: previous.data } : {}),
    updatedAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    transaction.objectStore(ASSET_STORE).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function storeAsrAssetBytes(input: {
  readonly modelId: SupportedAsrModelId;
  readonly url: string;
  readonly bytes: Uint8Array;
}): Promise<void> {
  if (!hasIndexedDb()) return;
  const owned = Uint8Array.from(input.bytes);
  const record: CachedAsrAsset = {
    key: cacheKey(input.url),
    modelId: input.modelId,
    revision: ASR_MODEL_REVISIONS[input.modelId],
    url: input.url,
    status: 200,
    headers: [
      ['content-length', String(owned.byteLength)],
      ['content-type', contentTypeForUrl(input.url)],
    ],
    byteLength: owned.byteLength,
    admitted: false,
    sha256: await sha256(owned),
    data: new Blob([owned], { type: contentTypeForUrl(input.url) }),
    updatedAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    transaction.objectStore(ASSET_STORE).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function commitAsrModelCacheManifest(
  modelId: SupportedAsrModelId,
  requirements: readonly AsrAssetRequirement[],
): Promise<void> {
  if (!hasIndexedDb()) return;
  const deduplicated = new Map<string, boolean>();
  for (const requirement of requirements) {
    deduplicated.set(
      requirement.url,
      Boolean(deduplicated.get(requirement.url) || requirement.needsBytes),
    );
  }
  if (deduplicated.size === 0) throw new Error('Речевая модель не запросила ни одного файла.');

  const records: CachedAsrAsset[] = [];
  for (const [url, needsBytes] of deduplicated) {
    const record = await loadRecord(modelId, url);
    if (!record || (needsBytes && (!record.data || !record.sha256 || record.data.size === 0))) {
      throw new Error(`Кэш речевой модели неполный: ${url}`);
    }
    records.push(record);
  }

  const manifest: CachedAsrModelManifest = {
    modelId,
    revision: ASR_MODEL_REVISIONS[modelId],
    version: ASR_DOWNLOAD_VERSION,
    requirements: [...deduplicated].map(([url, needsBytes]) => ({ url, needsBytes })),
    updatedAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction([ASSET_STORE, MANIFEST_STORE], 'readwrite');
    const assets = transaction.objectStore(ASSET_STORE);
    for (const record of records) assets.put({ ...record, admitted: true });
    transaction.objectStore(MANIFEST_STORE).put(manifest);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  if (typeof navigator !== 'undefined') {
    try {
      await navigator.storage?.persist?.();
    } catch {
      // Persistence is a browser hint; the verified cache remains usable without it.
    }
  }
}

export async function discardUnadmittedAsrAssets(
  modelId: SupportedAsrModelId,
): Promise<void> {
  if (!hasIndexedDb()) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    const request = transaction.objectStore(ASSET_STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as CachedAsrAsset;
      if (record.modelId === modelId && !record.admitted) cursor.delete();
      cursor.continue();
    };
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function hasCompleteCachedAsrModel(
  modelId: SupportedAsrModelId,
): Promise<boolean> {
  if (!hasIndexedDb()) return false;
  const database = await openDatabase();
  let manifest: CachedAsrModelManifest | undefined;
  try {
    const transaction = database.transaction(MANIFEST_STORE, 'readonly');
    manifest = await requestResult(
      transaction.objectStore(MANIFEST_STORE).get(modelId) as IDBRequest<
        CachedAsrModelManifest | undefined
      >,
    );
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  if (
    !manifest ||
    manifest.version !== ASR_DOWNLOAD_VERSION ||
    manifest.revision !== ASR_MODEL_REVISIONS[modelId] ||
    manifest.requirements.length === 0
  ) {
    return false;
  }

  for (const requirement of manifest.requirements) {
    const record = await loadRecord(modelId, requirement.url);
    if (!record?.admitted) return false;
    if (requirement.needsBytes && (!record.data || !record.sha256 || record.data.size === 0)) {
      return false;
    }
  }
  return true;
}
