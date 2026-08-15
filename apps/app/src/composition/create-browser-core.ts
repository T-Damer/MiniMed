import { Capacitor } from '@capacitor/core';
import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { type MedicalStore, type MedicalStoreMount, MultiMedicalStore } from '@localmed/storage';
import { CapacitorMedicalStore } from '@localmed/storage-capacitor';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';

import { createRegisteredExternalMedicalCore } from '@/composition/external-medical-core';
import { loadInstalledModuleMounts } from '@/features/modules/browser-module-runtime';

interface PackBuildReport {
  readonly outputChecksum: string;
}

interface CompanionStores {
  readonly mkbStore?: MedicalStore;
  readonly medicationsStore?: MedicalStore;
  readonly ambulatoryStore?: MedicalStore;
  readonly regulatoryStore?: MedicalStore;
  readonly referenceStore?: MedicalStore;
}

const QUERY_EMBEDDER = new PortableHashEmbedder();

const PACK_DATABASE_NAME = 'core-demo.db';
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
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\u0000');

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

async function fetchContent(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTENT_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
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
  const response = await fetchContent(new URL('content/core-demo-report.json', contentBaseUrl));
  if (!response.ok) {
    throw new Error(`Unable to load content-pack report (${response.status}).`);
  }
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('outputChecksum' in value) ||
    typeof value.outputChecksum !== 'string'
  ) {
    throw new Error('Content-pack report does not contain outputChecksum.');
  }
  return { outputChecksum: value.outputChecksum };
}

async function createNativeStore(): Promise<CapacitorMedicalStore> {
  const report = await readPackReport();
  const store = new CapacitorMedicalStore({
    assetPath: PACK_ASSET_PATH,
    databaseName: PACK_DATABASE_NAME,
    expectedSha256: report.outputChecksum,
  });
  await withTimeout(store.initialize(), CONTENT_OPEN_TIMEOUT_MS, 'Native content database');
  return store;
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
  return withTimeout(
    SqliteMedicalStore.createFromBytes(bytes),
    CONTENT_OPEN_TIMEOUT_MS,
    `Opening ${databaseName}`,
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
      required: true,
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

async function createPackagedCompanionStores(contentBaseUrl: string): Promise<CompanionStores> {
  const [mkbStore, medicationsStore, ambulatoryStore, regulatoryStore, referenceStore] =
    await Promise.all([
      createOptionalPackagedStore(contentBaseUrl, MKB_DATABASE_NAME),
      createOptionalPackagedStore(contentBaseUrl, MEDICATIONS_DATABASE_NAME),
      createOptionalPackagedStore(contentBaseUrl, AMBULATORY_DATABASE_NAME),
      createOptionalPackagedStore(contentBaseUrl, REGULATORY_DATABASE_NAME),
      createOptionalPackagedStore(contentBaseUrl, REFERENCE_DATABASE_NAME),
    ]);
  return {
    ...(mkbStore ? { mkbStore } : {}),
    ...(medicationsStore ? { medicationsStore } : {}),
    ...(ambulatoryStore ? { ambulatoryStore } : {}),
    ...(regulatoryStore ? { regulatoryStore } : {}),
    ...(referenceStore ? { referenceStore } : {}),
  };
}

export async function createBrowserCore() {
  try {
    const externalCore = await createRegisteredExternalMedicalCore();
    if (externalCore) return externalCore;
  } catch (error) {
    console.warn('External MedicalCore unavailable; falling back to MiniMed storage.', error);
  }

  const nativePlatform = Capacitor.getPlatform();
  const platform =
    nativePlatform === 'android' || nativePlatform === 'ios' ? nativePlatform : 'web';

  if (platform === 'android' || platform === 'ios') {
    try {
      const contentBaseUrl = getPackagedContentBaseUrl();
      const store = await withInstalledModules(
        await createNativeStore(),
        await createPackagedCompanionStores(contentBaseUrl),
      );
      return createMedicalCore({ store, platform, embedder: QUERY_EMBEDDER });
    } catch (error) {
      console.warn('Native SQLite unavailable; falling back to the packaged WASM database.', error);
    }
  }

  try {
    const contentBaseUrl = getPackagedContentBaseUrl();
    const [coreStore, companions] = await Promise.all([
      createPackagedWasmStore(contentBaseUrl),
      createPackagedCompanionStores(contentBaseUrl),
    ]);
    const store = await withInstalledModules(coreStore, companions);
    return createMedicalCore({ store, platform, embedder: QUERY_EMBEDDER });
  } catch (error) {
    console.warn('Compiled content pack unavailable; falling back to the embedded seed.', error);
    const store = await SqliteMedicalStore.create();
    const contentBaseUrl = getPackagedContentBaseUrl();
    const composed = await withInstalledModules(
      store,
      await createPackagedCompanionStores(contentBaseUrl),
      true,
    );
    return createMedicalCore({
      store: composed,
      seed: DEMO_CONTENT_PACK,
      platform,
      embedder: QUERY_EMBEDDER,
    });
  }
}

export async function createBrowserWorkerCore(contentBaseUrl: string) {
  try {
    const [coreStore, companions] = await Promise.all([
      createPackagedWasmStore(contentBaseUrl),
      createPackagedCompanionStores(contentBaseUrl),
    ]);
    const store = await withInstalledModules(coreStore, companions);
    return createMedicalCore({ store, platform: 'web', embedder: QUERY_EMBEDDER });
  } catch (error) {
    console.warn('Worker content pack unavailable; falling back to the embedded seed.', error);
    const store = await SqliteMedicalStore.create();
    const composed = await withInstalledModules(
      store,
      await createPackagedCompanionStores(contentBaseUrl),
      true,
    );
    return createMedicalCore({
      store: composed,
      seed: DEMO_CONTENT_PACK,
      platform: 'web',
      embedder: QUERY_EMBEDDER,
    });
  }
}
