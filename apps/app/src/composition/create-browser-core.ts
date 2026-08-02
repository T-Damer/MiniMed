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
  readonly medicationsStore: MedicalStore;
  readonly regulatoryStore?: MedicalStore;
  readonly referenceStore?: MedicalStore;
}

const QUERY_EMBEDDER = new PortableHashEmbedder();

const PACK_DATABASE_NAME = 'core-demo.db';
const MEDICATIONS_DATABASE_NAME = 'medications.db';
const REGULATORY_DATABASE_NAME = 'regulatory.db';
const REFERENCE_DATABASE_NAME = 'reference.db';
const PACK_ASSET_PATH = `public/content/${PACK_DATABASE_NAME}`;
const BUILT_IN_REGULATORY_MODULE_ID = 'minimed.regulatory.pediatrics.ru';
const BUILT_IN_REFERENCE_MODULE_ID = 'minimed.reference.ru';

async function readPackReport(contentBaseUrl = import.meta.env.BASE_URL): Promise<PackBuildReport> {
  const response = await fetch(new URL('content/core-demo-report.json', contentBaseUrl));
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
  const report = await readPackReport(new URL(import.meta.env.BASE_URL, window.location.href).href);
  const store = new CapacitorMedicalStore({
    assetPath: PACK_ASSET_PATH,
    databaseName: PACK_DATABASE_NAME,
    expectedSha256: report.outputChecksum,
  });
  // Probe the native plugin before returning the core so a missing plugin or system FTS5
  // incompatibility can fall back to SQLite WASM without breaking application startup.
  await store.initialize();
  return store;
}

async function createPackagedWasmStore(
  contentBaseUrl: string,
  databaseName = PACK_DATABASE_NAME,
): Promise<SqliteMedicalStore> {
  const response = await fetch(new URL(`content/${databaseName}`, contentBaseUrl));
  if (!response.ok) {
    throw new Error(`Unable to load compiled content pack (${response.status}).`);
  }
  return SqliteMedicalStore.createFromBytes(new Uint8Array(await response.arrayBuffer()));
}

export function builtInCompanionMounts(
  companions: CompanionStores,
  installedModuleIds: ReadonlySet<string>,
): readonly MedicalStoreMount[] {
  const mounts: MedicalStoreMount[] = [
    {
      moduleId: 'minimed.medications.ru',
      store: companions.medicationsStore,
      required: true,
      enabled: true,
      searchWeight: 1.15,
    },
  ];
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
  const medicationsStore = await createPackagedWasmStore(contentBaseUrl, MEDICATIONS_DATABASE_NAME);
  const [regulatoryStore, referenceStore] = await Promise.all([
    createOptionalPackagedStore(contentBaseUrl, REGULATORY_DATABASE_NAME),
    createOptionalPackagedStore(contentBaseUrl, REFERENCE_DATABASE_NAME),
  ]);
  return {
    medicationsStore,
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
      const contentBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href).href;
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
    const contentBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href).href;
    const store = await withInstalledModules(
      await createPackagedWasmStore(contentBaseUrl),
      await createPackagedCompanionStores(contentBaseUrl),
    );
    return createMedicalCore({ store, platform, embedder: QUERY_EMBEDDER });
  } catch (error) {
    console.warn('Compiled content pack unavailable; falling back to the embedded seed.', error);
    const store = await SqliteMedicalStore.create();
    const contentBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href).href;
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
    const store = await withInstalledModules(
      await createPackagedWasmStore(contentBaseUrl),
      await createPackagedCompanionStores(contentBaseUrl),
    );
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
