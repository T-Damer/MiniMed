import type { ContentModuleCatalog } from '@localmed/contracts';

import { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';

let sharedRuntime: BrowserContentModuleRuntime | null = null;
let sharedCatalogGeneration = 0;

function catalogGeneration(catalog: ContentModuleCatalog): number {
  return catalog.modules.length + catalog.categories.length;
}

export function getContentModuleRuntime(
  catalog: ContentModuleCatalog,
): BrowserContentModuleRuntime {
  const generation = catalogGeneration(catalog);
  if (!sharedRuntime || sharedCatalogGeneration !== generation) {
    sharedRuntime = new BrowserContentModuleRuntime(catalog);
    sharedCatalogGeneration = generation;
  }
  return sharedRuntime;
}

export function resetContentModuleRuntimeForTests(): void {
  sharedRuntime = null;
  sharedCatalogGeneration = 0;
}
