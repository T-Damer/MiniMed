import {
  type EcgModelCatalogItem,
  resolveEcgModelDownloadUrl,
} from '@/features/calculators/ecg-model';
import type { DownloadContext } from '@/features/downloads/download-queue';
import { downloadWithRetry } from '@/features/network/download-retry';
import { listZipEntries, readZipEntry } from '@/state/user-library-zip';
import {
  ECG_NUMERIC_FEATURES,
  type EcgDiagnosticEstimate,
  type EcgNumericDiagnosticPack,
  type EcgNumericFeatureId,
  inferEcgNumericDiagnostic,
  parseEcgNumericDiagnosticPack,
} from './ecg-numeric-inference';

export {
  ECG_NUMERIC_FEATURES,
  type EcgDiagnosticEstimate,
  type EcgNumericFeatureId,
} from './ecg-numeric-inference';

const STORAGE_KEY = 'minimed.ecg-diagnostic-model';
const CHANGE_EVENT = 'minimed:ecg-diagnostic-model-change';
const CACHE_PREFIX = 'minimed-ecg-diagnostic-model-';
const MANIFEST_FILE = 'minimed-ecg-diagnostic-pack.json';
const MODEL_FILE = 'hgb-model.json';
const STORAGE_ORIGIN = 'https://minimed.local/ecg-diagnostic-model/';

export interface EcgDiagnosticModelDescriptor {
  readonly cacheName: string;
  readonly checksum: string;
  readonly fileBytes: number;
  readonly installedAt: string;
  readonly kind: 'numeric-diagnostic';
  readonly license: string;
  readonly name: string;
  readonly source: string;
  readonly version: string;
}

interface DiagnosticManifest {
  readonly format: 'minimed-ecg-diagnostic-pack';
  readonly formatVersion: 1;
  readonly kind: 'numeric-diagnostic';
  readonly license: string;
  readonly minimumAgeYears: 18;
  readonly name: string;
  readonly source: string;
  readonly version: string;
}

export const ECG_DIAGNOSTIC_MODEL_CATALOG: readonly EcgModelCatalogItem[] = [
  {
    id: 'ptb-xl-plus-numeric-adult-2026-2',
    name: 'PTB-XL+ Numeric ECG',
    description:
      'Пять вероятностных гипотез по 30 подтверждённым интервалам и амплитудам: норма, MI-паттерн, ST/T, проводимость и гипертрофия. Только для взрослых.',
    version: '2026.2',
    license: 'CC BY 4.0',
    sourceUrl: 'https://physionet.org/content/ptb-xl-plus/1.0.1/',
    bundleUrl:
      'https://raw.githubusercontent.com/T-Damer/MiniMed/datasets/content-2026-09-06/models/minimed-ecg-numeric-adult-2026.2.zip',
    bundleSha256: 'f51d88ced3687fe0840eff51d8187ea59a6ba401b5c364368cf0b6140e09832d',
    downloadBytes: 261_070,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new Error(`${label}: отсутствует или имеет неверный формат.`);
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

function parseManifest(bytes: Uint8Array): DiagnosticManifest {
  const value = parseJson(bytes, MANIFEST_FILE);
  if (!isRecord(value)) throw new Error('Manifest числовой модели должен быть JSON-объектом.');
  const candidate = value as {
    readonly format?: unknown;
    readonly formatVersion?: unknown;
    readonly kind?: unknown;
    readonly license?: unknown;
    readonly minimumAgeYears?: unknown;
    readonly name?: unknown;
    readonly source?: unknown;
    readonly version?: unknown;
  };
  if (
    candidate.format !== 'minimed-ecg-diagnostic-pack' ||
    candidate.formatVersion !== 1 ||
    candidate.kind !== 'numeric-diagnostic' ||
    candidate.minimumAgeYears !== 18
  ) {
    throw new Error('Неподдерживаемый формат числовой модели ЭКГ.');
  }
  return {
    format: 'minimed-ecg-diagnostic-pack',
    formatVersion: 1,
    kind: 'numeric-diagnostic',
    license: text(candidate.license, 'license'),
    minimumAgeYears: 18,
    name: text(candidate.name, 'name'),
    source: text(candidate.source, 'source'),
    version: text(candidate.version, 'version'),
  };
}

export function validateEcgDiagnosticModelFiles(files: ReadonlyMap<string, Uint8Array>): {
  readonly manifest: DiagnosticManifest;
} {
  const required = (path: string): Uint8Array => {
    const bytes = files.get(path);
    if (!bytes?.byteLength) throw new Error(`В архиве отсутствует или пуст ${path}.`);
    return bytes;
  };
  const manifest = parseManifest(required(MANIFEST_FILE));
  const pack = parseEcgNumericDiagnosticPack(required(MODEL_FILE));
  if (pack.version !== manifest.version) {
    throw new Error('Версии манифеста и числовой модели ЭКГ не совпадают.');
  }
  return { manifest };
}

function normalizedArchivePath(path: string): string {
  const normalized = path.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Архив числовой модели содержит небезопасный путь: ${path}.`);
  }
  return normalized;
}

function storageUrl(path: string): string {
  return `${STORAGE_ORIGIN}${encodeURIComponent(path)}`;
}

async function digestHex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storedCacheName(): string | null {
  return readEcgDiagnosticModelDescriptor()?.cacheName ?? null;
}

function writeDescriptor(descriptor: EcgDiagnosticModelDescriptor | null): void {
  if (descriptor) localStorage.setItem(STORAGE_KEY, JSON.stringify(descriptor));
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readEcgDiagnosticModelDescriptor(): EcgDiagnosticModelDescriptor | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!isRecord(value)) return null;
    const candidate = value as Partial<EcgDiagnosticModelDescriptor>;
    if (
      candidate.kind !== 'numeric-diagnostic' ||
      typeof candidate.cacheName !== 'string' ||
      !candidate.cacheName.startsWith(CACHE_PREFIX) ||
      typeof candidate.checksum !== 'string' ||
      typeof candidate.fileBytes !== 'number' ||
      typeof candidate.installedAt !== 'string' ||
      typeof candidate.license !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.source !== 'string' ||
      typeof candidate.version !== 'string'
    )
      return null;
    return value as unknown as EcgDiagnosticModelDescriptor;
  } catch {
    return null;
  }
}

export function subscribeEcgDiagnosticModel(listener: () => void): () => void {
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

export async function verifyEcgDiagnosticModelDownload(
  model: EcgModelCatalogItem,
  bytes: Uint8Array,
): Promise<ArrayBuffer> {
  if (bytes.byteLength !== model.downloadBytes)
    throw new Error('Размер числовой модели не совпадает с каталогом.');
  const data = Uint8Array.from(bytes).buffer;
  if ((await digestHex(data)) !== model.bundleSha256)
    throw new Error('Контрольная сумма числовой модели не совпадает с каталогом.');
  return data;
}

async function installArchive(data: ArrayBuffer): Promise<EcgDiagnosticModelDescriptor> {
  if (!('caches' in window))
    throw new Error('Браузер не поддерживает локальное хранилище моделей.');
  const entries = (await listZipEntries(data)).map(normalizedArchivePath);
  const manifestEntries = entries.filter(
    (path) => path === MANIFEST_FILE || path.endsWith(`/${MANIFEST_FILE}`),
  );
  if (manifestEntries.length !== 1)
    throw new Error(`Архив должен содержать один ${MANIFEST_FILE}.`);
  const manifestPath = manifestEntries[0] ?? '';
  const root = manifestPath.slice(0, -MANIFEST_FILE.length);
  const archivePath = (path: string): string => {
    const found = entries.find((entry) => entry === `${root}${path}`);
    if (!found) throw new Error(`В архиве отсутствует ${path}.`);
    return found;
  };
  const manifestBytes = await readZipEntry(data, archivePath(MANIFEST_FILE));
  const modelBytes = await readZipEntry(data, archivePath(MODEL_FILE));
  if (!manifestBytes?.byteLength || !modelBytes?.byteLength)
    throw new Error('Архив числовой модели содержит пустой файл.');
  const { manifest } = validateEcgDiagnosticModelFiles(
    new Map([
      [MANIFEST_FILE, manifestBytes],
      [MODEL_FILE, modelBytes],
    ]),
  );
  const checksum = await digestHex(data);
  const cacheName = `${CACHE_PREFIX}${checksum.slice(0, 24)}-${Date.now().toString(36)}`;
  const previousCacheName = storedCacheName();
  const cache = await caches.open(cacheName);
  try {
    await cache.put(storageUrl(MANIFEST_FILE), new Response(Uint8Array.from(manifestBytes)));
    await cache.put(storageUrl(MODEL_FILE), new Response(Uint8Array.from(modelBytes)));
  } catch (cause) {
    await caches.delete(cacheName);
    throw cause;
  }
  const descriptor: EcgDiagnosticModelDescriptor = {
    cacheName,
    checksum,
    fileBytes: data.byteLength,
    installedAt: new Date().toISOString(),
    kind: 'numeric-diagnostic',
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
  loadedPack = null;
  return descriptor;
}

export async function installEcgDiagnosticModelFromCatalog(
  model: EcgModelCatalogItem,
  options: {
    readonly signal?: AbortSignal;
    readonly downloadContext?: DownloadContext;
    readonly onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  } = {},
): Promise<EcgDiagnosticModelDescriptor> {
  const bytes = await downloadWithRetry({
    ...(options.downloadContext ? { jobId: options.downloadContext.id, trackProgress: false } : {}),
    url: resolveEcgModelDownloadUrl(model.bundleUrl),
    cacheKey: `ecg-diagnostic:${model.id}:${model.bundleSha256}`,
    expectedBytes: model.downloadBytes,
    ...(options.signal ? { signal: options.signal } : {}),
    retryMissingAssets: false,
    onProgress: ({ downloadedBytes, totalBytes }) =>
      options.onProgress?.(downloadedBytes, totalBytes ?? model.downloadBytes),
  });
  options.signal?.throwIfAborted();
  options.downloadContext?.phase('verifying');
  const verified = await verifyEcgDiagnosticModelDownload(model, bytes);
  options.signal?.throwIfAborted();
  // Cache activation is atomic; the package observes its result before honouring a late abort.
  return installArchive(verified);
}

export async function removeEcgDiagnosticModel(): Promise<void> {
  const cacheName = storedCacheName();
  writeDescriptor(null);
  loadedPack = null;
  if (cacheName) await caches.delete(cacheName);
}

let loadedPack: { readonly cacheName: string; readonly pack: EcgNumericDiagnosticPack } | null =
  null;

async function readInstalledPack(): Promise<EcgNumericDiagnosticPack> {
  const descriptor = readEcgDiagnosticModelDescriptor();
  if (!descriptor) throw new Error('Сначала установите числовую модель ЭКГ в настройках.');
  if (loadedPack?.cacheName === descriptor.cacheName) return loadedPack.pack;
  const cache = await caches.open(descriptor.cacheName);
  const response = await cache.match(storageUrl(MODEL_FILE));
  if (!response) throw new Error('Файл числовой модели отсутствует. Переустановите модель.');
  const pack = parseEcgNumericDiagnosticPack(new Uint8Array(await response.arrayBuffer()));
  loadedPack = { cacheName: descriptor.cacheName, pack };
  return pack;
}

export async function estimateEcgFromNumericFeatures(input: {
  readonly ageYears: number;
  readonly values: Readonly<Record<EcgNumericFeatureId, number>>;
}): Promise<readonly EcgDiagnosticEstimate[]> {
  if (!Number.isFinite(input.ageYears) || input.ageYears < 18 || input.ageYears > 120) {
    throw new Error('Числовая модель проверена только для взрослых от 18 до 120 лет.');
  }
  const row = ECG_NUMERIC_FEATURES.map((feature) => {
    const value = input.values[feature.id];
    if (!Number.isFinite(value) || value < feature.min || value > feature.max) {
      throw new Error(
        `${feature.label}: введите значение ${feature.min}–${feature.max} ${feature.unit === 'ms' ? 'мс' : 'мВ'}.`,
      );
    }
    return value;
  });
  const pack = await readInstalledPack();
  return inferEcgNumericDiagnostic(pack.classes, pack.models, row);
}
