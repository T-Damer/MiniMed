import { Capacitor } from '@capacitor/core';
import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { CapacitorMedicalStore } from '@localmed/storage-capacitor';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';

interface PackBuildReport {
  readonly outputChecksum: string;
}

const QUERY_EMBEDDER = new PortableHashEmbedder();

const PACK_DATABASE_NAME = 'core-demo.db';
const PACK_ASSET_PATH = `public/content/${PACK_DATABASE_NAME}`;

async function readPackReport(): Promise<PackBuildReport> {
  const response = await fetch(`${import.meta.env.BASE_URL}content/core-demo-report.json`);
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
  // Probe the native plugin before returning the core so a missing plugin or system FTS5
  // incompatibility can fall back to SQLite WASM without breaking application startup.
  await store.initialize();
  return store;
}

async function createPackagedWasmStore(): Promise<SqliteMedicalStore> {
  const response = await fetch(`${import.meta.env.BASE_URL}content/${PACK_DATABASE_NAME}`);
  if (!response.ok) {
    throw new Error(`Unable to load compiled content pack (${response.status}).`);
  }
  return SqliteMedicalStore.createFromBytes(new Uint8Array(await response.arrayBuffer()));
}

export async function createBrowserCore() {
  const nativePlatform = Capacitor.getPlatform();
  const platform =
    nativePlatform === 'android' || nativePlatform === 'ios' ? nativePlatform : 'web';

  if (platform === 'android' || platform === 'ios') {
    try {
      const store = await createNativeStore();
      return createMedicalCore({ store, platform, embedder: QUERY_EMBEDDER });
    } catch (error) {
      console.warn('Native SQLite unavailable; falling back to the packaged WASM database.', error);
    }
  }

  try {
    const store = await createPackagedWasmStore();
    return createMedicalCore({ store, platform, embedder: QUERY_EMBEDDER });
  } catch (error) {
    console.warn('Compiled content pack unavailable; falling back to the embedded seed.', error);
    const store = await SqliteMedicalStore.create();
    return createMedicalCore({
      store,
      seed: DEMO_CONTENT_PACK,
      platform,
      embedder: QUERY_EMBEDDER,
    });
  }
}
