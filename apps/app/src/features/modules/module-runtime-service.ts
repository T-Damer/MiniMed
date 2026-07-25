import type { ContentModuleCatalog } from '@localmed/contracts';

import { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import { recoverPendingModuleInstalls } from '@/features/modules/pending-module-installs';

let sharedRuntime: BrowserContentModuleRuntime | null = null;
let sharedCatalogFingerprint = '';

export function contentModuleCatalogFingerprint(catalog: ContentModuleCatalog): string {
  return JSON.stringify({
    catalogVersion: catalog.catalogVersion,
    channel: catalog.channel,
    modules: catalog.modules.map((module) => ({
      id: module.id,
      version: module.version,
      releaseState: module.releaseState,
      sourceSetDigest: module.sourceSetDigest,
      artifacts: module.artifacts.map((artifact) => ({
        id: artifact.id,
        url: artifact.url,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      })),
    })),
  });
}

export function getContentModuleRuntime(
  catalog: ContentModuleCatalog,
): BrowserContentModuleRuntime {
  const fingerprint = contentModuleCatalogFingerprint(catalog);
  if (!sharedRuntime || sharedCatalogFingerprint !== fingerprint) {
    sharedRuntime = new BrowserContentModuleRuntime(catalog);
    sharedCatalogFingerprint = fingerprint;
    // The runtime also performs an initial recovery. Calling it here is intentional: a refreshed
    // catalog may finally contain a queued module that the bundled catalog did not know about.
    recoverPendingModuleInstalls(
      sharedRuntime,
      catalog,
      new Set(sharedRuntime.listInstalled().map((module) => module.moduleId)),
    );
  }
  return sharedRuntime;
}

export function resetContentModuleRuntimeForTests(): void {
  sharedRuntime = null;
  sharedCatalogFingerprint = '';
}
