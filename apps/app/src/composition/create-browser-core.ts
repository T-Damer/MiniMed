import { Capacitor } from '@capacitor/core';
import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { type MedicalStore, MultiMedicalStore } from '@localmed/storage';
import { CapacitorMedicalStore } from '@localmed/storage-capacitor';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';

import { loadInstalledModuleMounts } from '@/features/modules/browser-module-runtime';

interface PackBuildReport {
  readonly outputChecksum: string;
}

const QUERY_EMBEDDER = new PortableHashEmbedder();

const PACK_DATABASE_NAME = 'core-demo.db';
const PACK_ASSET_PATH = `public/content/${PACK_DATABASE_NAME}`;

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

async function createPackagedWasmStore(contentBaseUrl: string): Promise<SqliteMedicalStore> {
  const response = await fetch(new URL(`content/${PACK_DATABASE_NAME}`, contentBaseUrl));
  if (!response.ok) {
    throw new Error(`Unable to load compiled content pack (${response.status}).`);
  }
  return SqliteMedicalStore.createFromBytes(new Uint8Array(await response.arrayBuffer()));
}

async function withInstalledModules(
  coreStore: MedicalStore,
  acceptsSeed = false,
): Promise<MedicalStore> {
  try {
    const modules = await loadInstalledModuleMounts();
    if (modules.length === 0) return coreStore;
    return new MultiMedicalStore([
      {
        moduleId: 'minimed.core.ru',
        store: coreStore,
        required: true,
        enabled: true,
        searchWeight: 1.1,
        acceptsSeed,
      },
      ...modules,
    ]);
  } catch (cause) {
    console.warn('Downloaded content modules could not be opened; using the built-in base.', cause);
    return coreStore;
  }
}

export async function createBrowserCore() {
  const nativePlatform = Capacitor.getPlatform();
  const platform =
    nativePlatform === 'android' || nativePlatform === 'ios' ? nativePlatform : 'web';

  if (platform === 'android' || platform === 'ios') {
    try {
      const store = await withInstalledModules(await createNativeStore());
      return createMedicalCore({ store, platform, embedder: QUERY_EMBEDDER });
    } catch (error) {
      console.warn('Native SQLite unavailable; falling back to the packaged WASM database.', error);
    }
  }

  try {
    const contentBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href).href;
    const store = await withInstalledModules(await createPackagedWasmStore(contentBaseUrl));
    return createMedicalCore({ store, platform, embedder: QUERY_EMBEDDER });
  } catch (error) {
    console.warn('Compiled content pack unavailable; falling back to the embedded seed.', error);
    const store = await SqliteMedicalStore.create();
    const composed = await withInstalledModules(store, true);
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
    const store = await withInstalledModules(await createPackagedWasmStore(contentBaseUrl));
    return createMedicalCore({ store, platform: 'web', embedder: QUERY_EMBEDDER });
  } catch (error) {
    console.warn('Worker content pack unavailable; falling back to the embedded seed.', error);
    const store = await SqliteMedicalStore.create();
    const composed = await withInstalledModules(store, true);
    return createMedicalCore({
      store: composed,
      seed: DEMO_CONTENT_PACK,
      platform: 'web',
      embedder: QUERY_EMBEDDER,
    });
  }
}
