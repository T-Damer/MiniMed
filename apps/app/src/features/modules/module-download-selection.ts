import type { ContentModuleCatalogEntry } from '@localmed/contracts';

export function selectBulkDownloadModules(
  recommendationBrowserOpen: boolean,
  recommendationModules: readonly ContentModuleCatalogEntry[],
  regularModules: readonly ContentModuleCatalogEntry[],
): readonly ContentModuleCatalogEntry[] {
  return recommendationBrowserOpen ? recommendationModules : regularModules;
}
