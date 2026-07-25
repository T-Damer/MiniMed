const DATABASE_NAME = 'minimed-resumable-downloads-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'partials';

const FLUSH_BYTES = 256 * 1024;

export interface ResumableDownloadProgress {
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
}

export interface ResumableDownloadOptions {
  readonly url: string;
  readonly cacheKey: string;
  readonly expectedBytes?: number | null;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ResumableDownloadProgress) => void;
}

interface PartialDownloadRecord {
  readonly key: string;
  readonly url: string;
  readonly totalBytes: number | null;
  readonly data: Blob;
  readonly updatedAt: string;
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
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Не удалось открыть хранилище загрузок.'));
  });
}

function hasIndexedDb(): boolean {
  return typeof globalThis.indexedDB?.open === 'function';
}

async function readPartial(key: string): Promise<PartialDownloadRecord | null> {
  if (!hasIndexedDb()) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const value = await requestResult(
      transaction.objectStore(STORE_NAME).get(key) as IDBRequest<PartialDownloadRecord | undefined>,
    );
    await transactionDone(transaction);
    return value ?? null;
  } finally {
    database.close();
  }
}

async function writePartial(record: PartialDownloadRecord): Promise<void> {
  if (!hasIndexedDb()) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function deletePartial(key: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(key);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

function parseTotalBytes(
  response: Response,
  fallback: number | null,
  existing: number | null,
): number | null {
  if (response.status === 206) {
    const contentRange = response.headers.get('content-range');
    const match = /^bytes \d+-\d+\/(\d+|\*)$/u.exec(contentRange ?? '');
    if (match?.[1] && match[1] !== '*') {
      const total = Number(match[1]);
      if (Number.isFinite(total) && total > 0) return total;
    }
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (response.status === 206 && Number.isFinite(contentLength) && contentLength > 0) {
    const resumedFrom = existing ?? 0;
    return resumedFrom + contentLength;
  }
  const headerTotal = Number(response.headers.get('content-length'));
  if (Number.isFinite(headerTotal) && headerTotal > 0) return headerTotal;
  return fallback;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Download aborted.', 'AbortError');
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function downloadWithResume(options: ResumableDownloadOptions): Promise<Uint8Array> {
  const { url, cacheKey, expectedBytes = null, signal, onProgress } = options;
  throwIfAborted(signal);

  const existing = await readPartial(cacheKey);
  let downloadedBytes = existing?.url === url ? existing.data.size : 0;
  let totalBytes = existing?.url === url ? existing.totalBytes : expectedBytes;
  let pendingParts: BlobPart[] = existing?.url === url ? [existing.data] : [];
  let bytesSinceFlush = 0;

  const reportProgress = (): void => {
    onProgress?.({ downloadedBytes, totalBytes });
  };

  const flushPartial = async (): Promise<void> => {
    if (pendingParts.length === 0) return;
    const data = new Blob(pendingParts);
    pendingParts = [data];
    bytesSinceFlush = 0;
    await writePartial({
      key: cacheKey,
      url,
      totalBytes,
      data,
      updatedAt: new Date().toISOString(),
    });
  };

  const persistOnAbort = (): void => {
    if (pendingParts.length === 0) return;
    const data = new Blob(pendingParts);
    void writePartial({
      key: cacheKey,
      url,
      totalBytes,
      data,
      updatedAt: new Date().toISOString(),
    });
  };

  if (downloadedBytes > 0) reportProgress();

  const requestInit: RequestInit = { cache: 'no-store' };
  if (signal) requestInit.signal = signal;
  if (downloadedBytes > 0) {
    requestInit.headers = { Range: `bytes=${downloadedBytes}-` };
  }

  const response = await fetch(url, requestInit);

  if (response.status === 416) {
    await deletePartial(cacheKey);
    downloadedBytes = 0;
    pendingParts = [];
    const retryInit: RequestInit = { cache: 'no-store' };
    if (signal) retryInit.signal = signal;
    const retry = await fetch(url, retryInit);
    if (!retry.ok) throw new Error(`Сервер ответил HTTP ${retry.status}.`);
    return readResponse(retry, 0, expectedBytes);
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`Сервер ответил HTTP ${response.status}.`);
  }

  if (response.status === 200 && downloadedBytes > 0) {
    await deletePartial(cacheKey);
    downloadedBytes = 0;
    pendingParts = [];
  }

  totalBytes = parseTotalBytes(response, expectedBytes, downloadedBytes);
  reportProgress();

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (response.status === 206) {
      const merged = new Uint8Array(downloadedBytes + bytes.byteLength);
      if (downloadedBytes > 0 && pendingParts[0] instanceof Blob) {
        merged.set(await blobToUint8Array(pendingParts[0] as Blob), 0);
      }
      merged.set(bytes, downloadedBytes);
      await deletePartial(cacheKey);
      onProgress?.({ downloadedBytes: merged.byteLength, totalBytes });
      return merged;
    }
    await deletePartial(cacheKey);
    onProgress?.({ downloadedBytes: bytes.byteLength, totalBytes });
    return bytes;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await reader.read();
      if (result.done) break;
      pendingParts.push(result.value);
      downloadedBytes += result.value.byteLength;
      bytesSinceFlush += result.value.byteLength;
      reportProgress();
      if (bytesSinceFlush >= FLUSH_BYTES) await flushPartial();
    }
  } catch (cause) {
    persistOnAbort();
    throw cause;
  }

  const data = new Blob(pendingParts);
  if (expectedBytes !== null && data.size !== expectedBytes) {
    await writePartial({
      key: cacheKey,
      url,
      totalBytes,
      data,
      updatedAt: new Date().toISOString(),
    });
    throw new Error(`Размер файла не совпал: ${data.size} != ${expectedBytes}.`);
  }

  await deletePartial(cacheKey);
  onProgress?.({ downloadedBytes: data.size, totalBytes: totalBytes ?? data.size });
  return blobToUint8Array(data);
}

async function readResponse(
  response: Response,
  offset: number,
  expectedBytes: number | null,
): Promise<Uint8Array> {
  const totalBytes = parseTotalBytes(response, expectedBytes, offset);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = offset;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    downloadedBytes += result.value.byteLength;
  }
  const bytes = new Uint8Array(downloadedBytes);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  if (expectedBytes !== null && bytes.byteLength !== expectedBytes) {
    throw new Error(`Размер файла не совпал: ${bytes.byteLength} != ${expectedBytes}.`);
  }
  if (totalBytes !== null && bytes.byteLength !== totalBytes) {
    throw new Error(`Размер файла не совпал: ${bytes.byteLength} != ${totalBytes}.`);
  }
  return bytes;
}

export async function clearResumableDownload(cacheKey: string): Promise<void> {
  await deletePartial(cacheKey);
}
