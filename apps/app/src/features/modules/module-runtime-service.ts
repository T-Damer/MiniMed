import type { ContentModuleCatalog } from '@localmed/contracts';

import { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';

let sharedRuntime: BrowserContentModuleRuntime | null = null;
let sharedCatalogFingerprint = '';
const runtimeListeners = new Set<(runtime: BrowserContentModuleRuntime) => void>();

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
  if (!sharedRuntime) {
    sharedRuntime = new BrowserContentModuleRuntime(catalog);
    sharedCatalogFingerprint = fingerprint;
    for (const listener of runtimeListeners) listener(sharedRuntime);
  } else if (sharedCatalogFingerprint !== fingerprint) {
    sharedRuntime.updateCatalog(catalog);
    sharedCatalogFingerprint = fingerprint;
  }
  return sharedRuntime;
}

export function peekContentModuleRuntime(): BrowserContentModuleRuntime | null {
  return sharedRuntime;
}

export function subscribeContentModuleRuntime(
  listener: (runtime: BrowserContentModuleRuntime) => void,
): () => void {
  runtimeListeners.add(listener);
  if (sharedRuntime) listener(sharedRuntime);
  return () => runtimeListeners.delete(listener);
}

export function resetContentModuleRuntimeForTests(): void {
  sharedRuntime?.dispose();
  sharedRuntime = null;
  sharedCatalogFingerprint = '';
  runtimeListeners.clear();
}
