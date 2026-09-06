import { Capacitor } from '@capacitor/core';
import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { type MedicalStore, type MedicalStoreMount, MultiMedicalStore } from '@localmed/storage';
import { CapacitorMedicalStore, LocalMedDatabase } from '@localmed/storage-capacitor';
import {
  hasOpfsSahPoolApis,
  SQLITE_WASM_DESERIALIZE_MAX_BYTES,
  SqliteMedicalStore,
} from '@localmed/storage-sqlite';

import { readBoundedResponse } from '@/composition/bounded-response';
import { createRegisteredExternalMedicalCore } from '@/composition/external-medical-core';
import { WorkerOpfsMedicalStore } from '@/composition/worker-opfs-medical-store';
import { loadInstalledModuleMounts } from '@/features/modules/browser-module-runtime';

interface PackBuildReport {
  readonly outputChecksum: string;
}

interface CompanionStores {
  mkbStore?: MedicalStore;
  medicationsStore?: MedicalStore;
  ambulatoryStore?: MedicalStore;
  regulatoryStore?: MedicalStore;
  referenceStore?: MedicalStore;
}

const QUERY_EMBEDDER = new PortableHashEmbedder();

const PACK_DATABASE_NAME = 'core.db';
const MKB_DATABASE_NAME = 'mkb.db';
const MEDICATIONS_DATABASE_NAME = 'medications.db';
const AMBULATORY_DATABASE_NAME = 'ambulatory.db';
const REGULATORY_DATABASE_NAME = 'regulatory.db';
const REFERENCE_DATABASE_NAME = 'reference.db';
const PACK_ASSET_PATH = `public/content/${PACK_DATABASE_NAME}`;
const BUILT_IN_REGULATORY_MODULE_ID = 'minimed.regulatory.pediatrics.ru';
// Must match the catalog id of the downloadable module built from the same source content
// (minimed.reference.pediatrics.ru in catalog.preview.json) — otherwise this guard fails to skip the
// built-in reference.db companion once that module is installed, and both mounts report the same
// content-pack ID, tripping MultiMedicalStore's "Duplicate active content-pack ID" validation.
const BUILT_IN_REFERENCE_MODULE_ID = 'minimed.reference.pediatrics.ru';
const BUILT_IN_AMBULATORY_MODULE_ID = 'minimed.ambulatory.v1';
const BUILT_IN_MKB_MODULE_ID = 'minimed.mkb.ru';
const CONTENT_FETCH_TIMEOUT_MS = 15_000;
const CONTENT_OPEN_TIMEOUT_MS = 15_000;
const OPFS_PACK_FETCH_TIMEOUT_MS = 180_000;
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\u0000');
// sqlite-wasm deserializes the whole file into the WASM heap. Local-dev companions such as
// mkb.db (~1.4 GB) and medications.db (~420 MB) cannot fit; opening them yields SQLITE_NOMEM.
const WASM_UNSAFE_COMPANION_DATABASES: ReadonlySet<string> = new Set([
  MKB_DATABASE_NAME,
  MEDICATIONS_DATABASE_NAME,
  AMBULATORY_DATABASE_NAME,
]);
const WASM_PACKAGED_COMPANION_MAX_BYTES = SQLITE_WASM_DESERIALIZE_MAX_BYTES;

function isFloatingWindowRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('minimed-floating')
  );
}

export function getPackagedContentBaseUrl(): string {
  const configuredBaseUrl = import.meta.env.VITE_CONTENT_BASE_URL?.trim();
  return new URL(configuredBaseUrl || import.meta.env.BASE_URL, window.location.href).href;
}

export function hasSqliteHeader(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= SQLITE_HEADER.byteLength &&
    SQLITE_HEADER.every((byte, index) => bytes[index] === byte)
  );
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchContent(url: URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTENT_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error(`Unable to load ${url.pathname}: request timed out.`);
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

async function readPackReport(
  contentBaseUrl = getPackagedContentBaseUrl(),
): Promise<PackBuildReport> {
  const response = await fetchContent(new URL('content/core-report.json', contentBaseUrl));
  if (!response.ok) {
    throw new Error(`Unable to load content-pack report (${response.status}).`);
  }
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('outputChecksum' in value) ||
    typeof value.outputChecksum !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.outputChecksum)
  ) {
    throw new Error('Content-pack report does not contain outputChecksum.');
  }
  return { outputChecksum: value.outputChecksum };
}

export interface CoreDownloadUi {
  readonly requestDownload: () => Promise<void>;
  readonly onProgress: (progress: { readonly loaded: number; readonly total: number }) => void;
}

export async function createNativeStore(
  downloadUi?: CoreDownloadUi,
): Promise<CapacitorMedicalStore> {
  const report = await readPackReport();
  if (Capacitor.getPlatform() === 'android' && downloadUi) {
    const options = { expectedSha256: report.outputChecksum };
    if (!(await LocalMedDatabase.hasCorePack(options)).installed) {
      await downloadUi.requestDownload();
      const listener = await LocalMedDatabase.addListener(
        'coreDownloadProgress',
        downloadUi.onProgress,
      );
      try {
        await LocalMedDatabase.downloadCorePack(options);
      } finally {
        await listener.remove();
      }
    }
  }
  const store = new CapacitorMedicalStore({
    assetPath: PACK_ASSET_PATH,
    databaseName: PACK_DATABASE_NAME,
    expectedSha256: report.outputChecksum,
  });
  try {
    // The native bridge has no cancellation API. A Promise.race timeout orphaned its open and
    // allowed the fallback to start while SQLite still owned the core. Await settlement instead.
    await store.initialize();
    return store;
  } catch (cause) {
    await store.close();
    throw cause;
  }
}

export function parseUnsafeWasmCompanionAllowlist(
  raw = String(
    (import.meta.env as { readonly VITE_OPEN_UNSAFE_WASM_COMPANIONS?: string })
      .VITE_OPEN_UNSAFE_WASM_COMPANIONS ?? '',
  ),
): ReadonlySet<string> {
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

export function shouldOpenPackagedWasmCompanion(
  databaseName: string,
  byteLength?: number,
  allowlist: ReadonlySet<string> = parseUnsafeWasmCompanionAllowlist(),
): boolean {
  if (allowlist.has(databaseName)) return true;
  if (WASM_UNSAFE_COMPANION_DATABASES.has(databaseName)) return false;
  if (byteLength !== undefined && byteLength > WASM_PACKAGED_COMPANION_MAX_BYTES) return false;
  return true;
}

async function createPackagedWasmStore(
  contentBaseUrl: string,
  databaseName = PACK_DATABASE_NAME,
): Promise<SqliteMedicalStore> {
  const response = await fetchContent(new URL(`content/${databaseName}`, contentBaseUrl));
  if (!response.ok) {
    throw new Error(`Unable to load compiled content pack (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!hasSqliteHeader(bytes)) {
    throw new Error(`Unable to load compiled content pack (${databaseName} is not SQLite).`);
  }
  if (
    databaseName !== PACK_DATABASE_NAME &&
    !shouldOpenPackagedWasmCompanion(databaseName, bytes.byteLength)
  ) {
    throw new Error(
      `Skipping ${databaseName}: too large to deserialize into SQLite WASM (${bytes.byteLength} bytes).`,
    );
  }
  return withTimeout(
    SqliteMedicalStore.createFromBytes(bytes),
    CONTENT_OPEN_TIMEOUT_MS,
    `Opening ${databaseName}`,
  );
}

async function packagedContentLength(url: URL): Promise<number | undefined> {
  try {
    const response = await fetchContent(url, { method: 'HEAD' });
    if (!response.ok) return undefined;
    const header = response.headers.get('Content-Length');
    if (header === null) return undefined;
    const value = Number(header);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function openRequiredCoreFromOpfs(
  url: string,
  databaseName = PACK_DATABASE_NAME,
): Promise<WorkerOpfsMedicalStore> {
  return WorkerOpfsMedicalStore.open({
    url,
    databaseName,
    fetchTimeoutMs: OPFS_PACK_FETCH_TIMEOUT_MS,
    poolName: 'minimed-sah-core',
  });
}

export async function createRequiredWebCoreStore(
  contentBaseUrl: string,
  databaseUrl?: string,
  cacheName = PACK_DATABASE_NAME,
): Promise<MedicalStore> {
  const url = new URL(databaseUrl ?? `content/${PACK_DATABASE_NAME}`, contentBaseUrl);
  const contentLength = await packagedContentLength(url);
  if (
    contentLength === undefined ||
    contentLength === 0 ||
    contentLength > SQLITE_WASM_DESERIALIZE_MAX_BYTES
  ) {
    return await openRequiredCoreFromOpfs(url.href, cacheName);
  }
  const response = await fetchContent(url);
  if (!response.ok) {
    throw new Error(`Unable to load compiled content pack (${response.status}).`);
  }
  const bytes = await readBoundedResponse(response, SQLITE_WASM_DESERIALIZE_MAX_BYTES);
  if (!bytes) {
    // A server may under-report HEAD. Cancel the bounded read and stream the original resource
    // in its worker instead of retaining a whole-core ArrayBuffer plus a copied Blob.
    return await openRequiredCoreFromOpfs(url.href, cacheName);
  }
  if (!hasSqliteHeader(bytes)) {
    throw new Error(`Unable to load compiled content pack (${PACK_DATABASE_NAME} is not SQLite).`);
  }
  return await withTimeout(
    SqliteMedicalStore.createFromBytes(bytes),
    CONTENT_OPEN_TIMEOUT_MS,
    `Opening ${PACK_DATABASE_NAME}`,
  );
}

export function builtInCompanionMounts(
  companions: CompanionStores,
  installedModuleIds: ReadonlySet<string>,
): readonly MedicalStoreMount[] {
  const mounts: MedicalStoreMount[] = [];
  if (companions.mkbStore && !installedModuleIds.has(BUILT_IN_MKB_MODULE_ID)) {
    mounts.push({
      moduleId: BUILT_IN_MKB_MODULE_ID,
      store: companions.mkbStore,
      required: true,
      enabled: true,
      searchWeight: 1.05,
    });
  }
  if (companions.medicationsStore) {
    mounts.push({
      moduleId: 'minimed.medications.ru',
      store: companions.medicationsStore,
      required: false,
      enabled: true,
      searchWeight: 1.15,
    });
  }
  if (companions.ambulatoryStore && !installedModuleIds.has(BUILT_IN_AMBULATORY_MODULE_ID)) {
    mounts.push({
      moduleId: BUILT_IN_AMBULATORY_MODULE_ID,
      store: companions.ambulatoryStore,
      required: true,
      enabled: true,
      searchWeight: 1.05,
    });
  }
  if (companions.regulatoryStore && !installedModuleIds.has(BUILT_IN_REGULATORY_MODULE_ID)) {
    mounts.push({
      moduleId: BUILT_IN_REGULATORY_MODULE_ID,
      store: companions.regulatoryStore,
      required: true,
      enabled: true,
      searchWeight: 1.12,
    });
  }
  if (companions.referenceStore && !installedModuleIds.has(BUILT_IN_REFERENCE_MODULE_ID)) {
    mounts.push({
      moduleId: BUILT_IN_REFERENCE_MODULE_ID,
      store: companions.referenceStore,
      required: true,
      enabled: true,
      searchWeight: 1.08,
    });
  }
  return mounts;
}

async function withInstalledModules(
  coreStore: MedicalStore,
  companions: CompanionStores,
  acceptsSeed = false,
): Promise<MedicalStore> {
  let installedModules: readonly MedicalStoreMount[] = [];
  try {
    installedModules = await loadInstalledModuleMounts();
  } catch (cause) {
    console.warn('Downloaded content modules could not be opened; using the built-in base.', cause);
  }

  const installedModuleIds = new Set(installedModules.map((module) => module.moduleId));
  const builtInMounts: MedicalStoreMount[] = [
    {
      moduleId: 'minimed.core.ru',
      store: coreStore,
      required: true,
      enabled: true,
      searchWeight: 1.1,
      acceptsSeed,
    },
    ...builtInCompanionMounts(companions, installedModuleIds),
  ];
  return new MultiMedicalStore([...builtInMounts, ...installedModules]);
}

export function shouldOpenPackagedMedicationsInSearchWorker(): boolean {
  return false;
}

async function createOptionalPackagedStore(
  contentBaseUrl: string,
  databaseName: string,
): Promise<MedicalStore | undefined> {
  try {
    return await createPackagedWasmStore(contentBaseUrl, databaseName);
  } catch (cause) {
    console.warn(`Optional packaged content ${databaseName} is unavailable.`, cause);
    return undefined;
  }
}

async function createOptionalOpfsStore(
  contentBaseUrl: string,
  databaseName: string,
): Promise<MedicalStore | undefined> {
  try {
    const url = new URL(`content/${databaseName}`, contentBaseUrl).href;
    const options = {
      url,
      databaseName,
      fetchTimeoutMs: OPFS_PACK_FETCH_TIMEOUT_MS,
      poolName: 'minimed-sah-pack',
    };
    // Keep the ~421 MB Allmed pack off the main-thread sqlite-wasm singleton. A dedicated
    // worker has its own WASM heap; SQLITE_NOMEM there skips this companion instead of
    // failing core boot.
    if (typeof Worker !== 'undefined') {
      return await WorkerOpfsMedicalStore.open(options);
    }
    if (hasOpfsSahPoolApis()) {
      const store = await SqliteMedicalStore.createFromOpfsUrl(url, databaseName, {
        fetchTimeoutMs: OPFS_PACK_FETCH_TIMEOUT_MS,
      });
      await withTimeout(store.initialize(), OPFS_PACK_FETCH_TIMEOUT_MS, `Opening ${databaseName}`);
      return store;
    }
    throw new Error('OPFS SAH APIs and Web Workers are unavailable.');
  } catch (cause) {
    console.warn(`Optional OPFS content ${databaseName} is unavailable.`, cause);
    return undefined;
  }
}

async function createPackagedCompanionStores(
  contentBaseUrl: string,
  options: { readonly includeMedications?: boolean } = {},
): Promise<CompanionStores> {
  const companions: CompanionStores = {};
  const allowlist = parseUnsafeWasmCompanionAllowlist();
  const includeMedications = options.includeMedications ?? true;
  // Small companions deserialize into the WASM heap. The Allmed medications pack (~420 MB) is opened
  // through OPFS so it is not copied into memory. mkb/ambulatory stay skipped unless allowlisted.
  const wasmCompanions = [
    ['regulatoryStore', REGULATORY_DATABASE_NAME],
    ['referenceStore', REFERENCE_DATABASE_NAME],
    ...(allowlist.has(MKB_DATABASE_NAME) ? ([['mkbStore', MKB_DATABASE_NAME]] as const) : []),
    ...(allowlist.has(AMBULATORY_DATABASE_NAME)
      ? ([['ambulatoryStore', AMBULATORY_DATABASE_NAME]] as const)
      : []),
    ...(allowlist.has(MEDICATIONS_DATABASE_NAME)
      ? ([['medicationsStore', MEDICATIONS_DATABASE_NAME]] as const)
      : []),
  ] as const;
  for (const [key, databaseName] of wasmCompanions) {
    if (!shouldOpenPackagedWasmCompanion(databaseName, undefined, allowlist)) continue;
    const store = await createOptionalPackagedStore(contentBaseUrl, databaseName);
    if (store) {
      companions[key] = store;
    }
  }
  if (includeMedications && !companions.medicationsStore) {
    const medicationsStore = await createOptionalOpfsStore(
      contentBaseUrl,
      MEDICATIONS_DATABASE_NAME,
    );
    if (medicationsStore) companions.medicationsStore = medicationsStore;
  }
  return companions;
}

export async function createBrowserCore(downloadUi?: CoreDownloadUi) {
  try {
    const externalCore = await createRegisteredExternalMedicalCore();
    if (externalCore) return externalCore;
  } catch (error) {
    console.warn('External MedicalCore unavailable; falling back to MiniMed storage.', error);
  }

  const nativePlatform = Capacitor.getPlatform();
  const platform =
    nativePlatform === 'android' || nativePlatform === 'ios' ? nativePlatform : 'web';

  let fallbackCoreUrl: string | undefined;
  if (platform === 'android' || platform === 'ios') {
    let nativeStore: CapacitorMedicalStore | undefined;
    try {
      nativeStore = await createNativeStore(downloadUi);
      const contentBaseUrl = getPackagedContentBaseUrl();
      const companions = await createPackagedCompanionStores(contentBaseUrl, {
        includeMedications: platform !== 'android' && !isFloatingWindowRuntime(),
      });
      const store = await withInstalledModules(nativeStore, companions);
      return createMedicalCore({
        store,
        platform,
        embedder: QUERY_EMBEDDER,
        searchExecution: companions.medicationsStore ? 'direct-only' : undefined,
      });
    } catch (error) {
      await nativeStore?.close();
      // A corrupt edition is not a backend capability failure. Never bypass native validation
      // by opening the same damaged bytes in WASM.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'NATIVE_PACK_VALIDATION_FAILED'
      )
        throw error;
      if (platform === 'android') {
        const report = await readPackReport();
        const local = await LocalMedDatabase.hasCorePack({ expectedSha256: report.outputChecksum });
        if (!local.installed || !local.databasePath) throw error;
        // Keep the existing WASM fallback on Android builds whose system SQLite lacks FTS5.
        // Serve the verified app-private file locally, without another network download.
        fallbackCoreUrl = Capacitor.convertFileSrc(local.databasePath);
      }
      console.warn('Native SQLite unavailable; falling back to the packaged WASM database.', error);
    }
  }

  try {
    const contentBaseUrl = getPackagedContentBaseUrl();
    const report = await readPackReport(contentBaseUrl);
    const coreStore = await createRequiredWebCoreStore(
      contentBaseUrl,
      fallbackCoreUrl,
      `core.${report.outputChecksum.slice(7)}.db`,
    );
    const companions = await createPackagedCompanionStores(contentBaseUrl, {
      includeMedications: platform !== 'android' && !isFloatingWindowRuntime(),
    });
    const store = await withInstalledModules(coreStore, companions);
    return createMedicalCore({
      store,
      platform,
      embedder: QUERY_EMBEDDER,
      // SQL already runs in the OPFS owner worker. A second search core would reopen its
      // exclusive pool and wait on the live owner's lock.
      searchExecution:
        coreStore instanceof WorkerOpfsMedicalStore || companions.medicationsStore
          ? 'direct-only'
          : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось открыть ядро MiniMed: ${message}`, { cause: error });
  }
}

export async function createBrowserWorkerCore(contentBaseUrl: string) {
  try {
    const report = await readPackReport(contentBaseUrl);
    const coreStore = await createRequiredWebCoreStore(
      contentBaseUrl,
      undefined,
      `core.${report.outputChecksum.slice(7)}.db`,
    );
    const companions = await createPackagedCompanionStores(contentBaseUrl, {
      includeMedications: shouldOpenPackagedMedicationsInSearchWorker(),
    });
    const store = await withInstalledModules(coreStore, companions);
    return createMedicalCore({ store, platform: 'web', embedder: QUERY_EMBEDDER });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось открыть ядро MiniMed: ${message}`, { cause: error });
  }
}
