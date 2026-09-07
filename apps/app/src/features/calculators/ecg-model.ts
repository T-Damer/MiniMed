import { Capacitor } from '@capacitor/core';
import {
  ECG_DIGITIZER_CONFIG_FILE,
  ECG_DIGITIZER_WEIGHTS_FILE,
  ECG_MODEL_FORMAT,
  ECG_MODEL_FORMAT_VERSION,
  ECG_MODEL_MANIFEST_FILE,
  type EcgDigitizationResult,
  type EcgModelDescriptor,
  type EcgPhotoCorners,
  ecgModelStorageUrl,
} from '@/features/calculators/ecg-model-contract';
import type { DownloadContext } from '@/features/downloads/download-queue';
import { downloadWithRetry } from '@/features/network/download-retry';
import { listZipEntries, readZipEntry } from '@/state/user-library-zip';

const STORAGE_KEY = 'minimed.ecg-model';
const CHANGE_EVENT = 'minimed:ecg-model-change';
const CACHE_PREFIX = 'minimed-ecg-model-';
const GITHUB_RELEASE_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/u;
const BROWSER_MODEL_MIRROR = 'https://t-damer.github.io/MiniMed/app/content/releases';

export interface EcgModelCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly license: string;
  readonly sourceUrl: string;
  readonly bundleUrl: string;
  readonly bundleSha256: string;
  readonly downloadBytes: number;
}

export const ECG_MODEL_CATALOG: readonly EcgModelCatalogItem[] = [
  {
    id: 'open-ecg-digitizer-2026-1',
    name: 'Open ECG Digitizer',
    description:
      'Локально преобразует стандартную 3×4 ЭКГ в числовые кривые. Диагностических классов и вероятностей в пакете нет.',
    version: '2026.1',
    license: 'CC BY-SA 4.0',
    sourceUrl: 'https://github.com/Ahus-AIM/Electrocardiogram-Digitization',
    bundleUrl:
      'https://github.com/T-Damer/MiniMed/releases/download/models-preview-1/minimed-ecg-open-digitizer-2026.1-q8.zip',
    bundleSha256: '4fd2344b7c2363e3587df85ba2dbd5f8c10b2e957b2f03c1d7124ab5e6619990',
    downloadBytes: 19_063_794,
  },
];

interface EcgModelManifest {
  readonly format: string;
  readonly formatVersion: number;
  readonly license: string;
  readonly name: string;
  readonly source: string;
  readonly version: string;
}

export interface ValidatedEcgModelFiles {
  readonly manifest: EcgModelManifest;
}

interface WorkerDigitizationMessage {
  readonly type: 'digitization-result';
  readonly requestId: string;
  readonly result: EcgDigitizationResult;
}

interface WorkerErrorMessage {
  readonly type: 'error';
  readonly requestId: string;
  readonly message: string;
}

type WorkerOutMessage = WorkerDigitizationMessage | WorkerErrorMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new Error(`Manifest оцифровщика: поле ${field} отсутствует или имеет неверный формат.`);
  }
  return value.trim();
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${label}: неверный JSON.`);
  }
}

function parseManifest(bytes: Uint8Array): EcgModelManifest {
  const value = parseJson(bytes, ECG_MODEL_MANIFEST_FILE);
  if (!isRecord(value)) throw new Error('Manifest оцифровщика должен быть JSON-объектом.');
  const candidate = value as {
    readonly format?: unknown;
    readonly formatVersion?: unknown;
    readonly license?: unknown;
    readonly name?: unknown;
    readonly source?: unknown;
    readonly version?: unknown;
  };
  if (
    candidate.format !== ECG_MODEL_FORMAT ||
    candidate.formatVersion !== ECG_MODEL_FORMAT_VERSION
  ) {
    throw new Error('Неподдерживаемый формат оцифровщика ЭКГ.');
  }
  return {
    format: ECG_MODEL_FORMAT,
    formatVersion: ECG_MODEL_FORMAT_VERSION,
    license: requiredText(candidate.license, 'license'),
    name: requiredText(candidate.name, 'name'),
    source: requiredText(candidate.source, 'source'),
    version: requiredText(candidate.version, 'version'),
  };
}

function normalizedArchivePath(path: string): string {
  const normalized = path.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Архив оцифровщика содержит небезопасный путь: ${path}.`);
  }
  return normalized;
}

function archiveRoot(entries: readonly string[]): string {
  const manifests = entries.filter(
    (path) => path === ECG_MODEL_MANIFEST_FILE || path.endsWith(`/${ECG_MODEL_MANIFEST_FILE}`),
  );
  if (manifests.length !== 1) {
    throw new Error(`Архив должен содержать один ${ECG_MODEL_MANIFEST_FILE}.`);
  }
  return manifests[0]?.slice(0, -ECG_MODEL_MANIFEST_FILE.length) ?? '';
}

export function validateEcgModelFiles(
  files: ReadonlyMap<string, Uint8Array>,
): ValidatedEcgModelFiles {
  const required = (path: string): Uint8Array => {
    const bytes = files.get(path);
    if (!bytes?.byteLength) throw new Error(`В архиве отсутствует или пуст ${path}.`);
    return bytes;
  };
  const manifest = parseManifest(required(ECG_MODEL_MANIFEST_FILE));
  const digitizer = parseJson(required(ECG_DIGITIZER_CONFIG_FILE), ECG_DIGITIZER_CONFIG_FILE);
  if (!isRecord(digitizer)) {
    throw new Error(`${ECG_DIGITIZER_CONFIG_FILE} должен быть JSON-объектом.`);
  }
  required(ECG_DIGITIZER_WEIGHTS_FILE);
  return { manifest };
}

async function digestHex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storedCacheName(): string | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!isRecord(value)) return null;
    const cacheName = (value as { readonly cacheName?: unknown }).cacheName;
    return typeof cacheName === 'string' && cacheName.startsWith(CACHE_PREFIX) ? cacheName : null;
  } catch {
    return null;
  }
}

function writeDescriptor(descriptor: EcgModelDescriptor | null): void {
  if (descriptor) localStorage.setItem(STORAGE_KEY, JSON.stringify(descriptor));
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readEcgModelDescriptor(): EcgModelDescriptor | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const candidate = value as Partial<EcgModelDescriptor>;
    if (
      !isRecord(value) ||
      candidate.kind !== 'waveform-digitizer' ||
      typeof candidate.cacheName !== 'string' ||
      typeof candidate.checksum !== 'string' ||
      typeof candidate.fileBytes !== 'number' ||
      typeof candidate.installedAt !== 'string' ||
      typeof candidate.license !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.source !== 'string' ||
      typeof candidate.version !== 'string'
    ) {
      return null;
    }
    return value as unknown as EcgModelDescriptor;
  } catch {
    return null;
  }
}

export function subscribeEcgModel(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

async function installEcgModelArchive(data: ArrayBuffer): Promise<EcgModelDescriptor> {
  if (!('caches' in window)) {
    throw new Error('Браузер не поддерживает локальное хранилище моделей.');
  }
  const entries = (await listZipEntries(data)).map(normalizedArchivePath);
  const root = archiveRoot(entries);
  const logicalEntries = new Map<string, string>();
  for (const entry of entries) {
    if (entry.startsWith(root) && !entry.endsWith('/')) {
      logicalEntries.set(entry.slice(root.length), entry);
    }
  }
  const readRequired = async (path: string): Promise<Uint8Array> => {
    const archivePath = logicalEntries.get(path);
    if (!archivePath) throw new Error(`В архиве отсутствует ${path}.`);
    const bytes = await readZipEntry(data, archivePath);
    if (!bytes?.byteLength) throw new Error(`Файл ${path} пуст.`);
    return bytes;
  };
  const requiredFiles = new Map<string, Uint8Array>();
  for (const path of [
    ECG_MODEL_MANIFEST_FILE,
    ECG_DIGITIZER_CONFIG_FILE,
    ECG_DIGITIZER_WEIGHTS_FILE,
  ]) {
    requiredFiles.set(path, await readRequired(path));
  }
  const { manifest } = validateEcgModelFiles(requiredFiles);
  const checksum = await digestHex(data);
  const cacheName = `${CACHE_PREFIX}${checksum.slice(0, 24)}-${Date.now().toString(36)}`;
  const previousCacheName = storedCacheName();
  const cache = await caches.open(cacheName);
  try {
    for (const [path, archivePath] of logicalEntries) {
      const bytes = await readZipEntry(data, archivePath);
      if (bytes) await cache.put(ecgModelStorageUrl(path), new Response(Uint8Array.from(bytes)));
    }
  } catch (cause) {
    await caches.delete(cacheName);
    throw cause;
  }
  const descriptor: EcgModelDescriptor = {
    cacheName,
    checksum,
    fileBytes: data.byteLength,
    installedAt: new Date().toISOString(),
    kind: 'waveform-digitizer',
    license: manifest.license,
    name: manifest.name,
    source: manifest.source,
    version: manifest.version,
  };
  try {
    writeDescriptor(descriptor);
  } catch (cause) {
    await caches.delete(cacheName);
    throw cause;
  }
  if (previousCacheName && previousCacheName !== cacheName) await caches.delete(previousCacheName);
  resetWorker();
  return descriptor;
}

export async function verifyEcgModelDownload(
  model: EcgModelCatalogItem,
  bytes: Uint8Array,
): Promise<ArrayBuffer> {
  if (bytes.byteLength !== model.downloadBytes) {
    throw new Error('Размер загруженного оцифровщика не совпадает с каталогом.');
  }
  const data = Uint8Array.from(bytes).buffer;
  if ((await digestHex(data)) !== model.bundleSha256) {
    throw new Error('Контрольная сумма загруженного оцифровщика не совпадает с каталогом.');
  }
  return data;
}

export function resolveEcgModelDownloadUrl(bundleUrl: string): string {
  const match = GITHUB_RELEASE_PATTERN.exec(bundleUrl);
  if (!match) return bundleUrl;
  const [, owner, repository, tag = '', fileName = ''] = match;
  if (owner !== 'T-Damer' || repository !== 'MiniMed') return bundleUrl;
  const relativePath = `${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
  if (Capacitor.isNativePlatform()) return `${BROWSER_MODEL_MIRROR}/${relativePath}`;
  return new URL(
    `./content/releases/${relativePath}`,
    new URL(import.meta.env.BASE_URL, window.location.href),
  ).toString();
}

export async function installEcgModelFromCatalog(
  model: EcgModelCatalogItem,
  options: {
    readonly signal?: AbortSignal;
    readonly downloadContext?: DownloadContext;
    readonly onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  } = {},
): Promise<EcgModelDescriptor> {
  const bytes = await downloadWithRetry({
    ...(options.downloadContext ? { jobId: options.downloadContext.id, trackProgress: false } : {}),
    url: resolveEcgModelDownloadUrl(model.bundleUrl),
    cacheKey: `ecg-digitizer:${model.id}:${model.bundleSha256}`,
    expectedBytes: model.downloadBytes,
    ...(options.signal ? { signal: options.signal } : {}),
    retryMissingAssets: false,
    onProgress: ({ downloadedBytes, totalBytes }) =>
      options.onProgress?.(downloadedBytes, totalBytes ?? model.downloadBytes),
  });
  options.signal?.throwIfAborted();
  options.downloadContext?.phase('verifying');
  const verified = await verifyEcgModelDownload(model, bytes);
  options.signal?.throwIfAborted();
  // Cache activation is atomic; the package observes its result before honouring a late abort.
  return installEcgModelArchive(verified);
}

export async function removeEcgModel(): Promise<void> {
  const cacheName = storedCacheName();
  writeDescriptor(null);
  resetWorker();
  if (cacheName) await caches.delete(cacheName);
}

let worker: Worker | null = null;
let requestCounter = 0;
const pendingDigitizations = new Map<
  string,
  { resolve: (value: EcgDigitizationResult) => void; reject: (error: Error) => void }
>();

function failPending(error: Error): void {
  for (const waiter of pendingDigitizations.values()) waiter.reject(error);
  pendingDigitizations.clear();
}

function resetWorker(error = new Error('Оцифровщик ЭКГ был остановлен.')): void {
  worker?.terminate();
  worker = null;
  failPending(error);
}

function workerInstance(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL('./ecg-model.worker.ts', import.meta.url), {
    type: 'module',
  });
  instance.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
    const message = event.data;
    const waiter = pendingDigitizations.get(message.requestId);
    if (!waiter) return;
    pendingDigitizations.delete(message.requestId);
    if (message.type === 'digitization-result') waiter.resolve(message.result);
    else waiter.reject(new Error(message.message));
  };
  instance.onerror = () => {
    worker = null;
    failPending(new Error('Локальный оцифровщик ЭКГ остановился с ошибкой.'));
  };
  worker = instance;
  return instance;
}

export async function digitizeEcgPhoto(
  file: File,
  corners?: EcgPhotoCorners,
): Promise<EcgDigitizationResult> {
  const descriptor = readEcgModelDescriptor();
  if (!descriptor) throw new Error('Сначала установите оцифровщик ЭКГ в настройках.');
  requestCounter += 1;
  const requestId = `ecg-digitize-${requestCounter}`;
  const image = await file.arrayBuffer();
  const promise = new Promise<EcgDigitizationResult>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      if (!pendingDigitizations.has(requestId)) return;
      resetWorker(
        new Error(
          'Оцифровка заняла больше минуты. Попробуйте переснять ЭКГ или продолжите ручную разметку.',
        ),
      );
    }, 60_000);
    pendingDigitizations.set(requestId, {
      reject: (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
      resolve: (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
    });
  });
  workerInstance().postMessage(
    {
      type: 'digitize',
      requestId,
      cacheName: descriptor.cacheName,
      image,
      mimeType: file.type,
      corners,
    },
    [image],
  );
  return await promise;
}

export type { EcgModelDescriptor };
