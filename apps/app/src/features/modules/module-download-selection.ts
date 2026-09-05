import type { ContentModuleCatalogEntry } from '@localmed/contracts';

export interface BulkDownloadSelectionInput {
  readonly coreLibraryOpen: boolean;
  readonly regularCollection: string;
  readonly recommendationBrowserOpen: boolean;
  readonly recommendationCategory: string;
  readonly catalogQuery: string;
  readonly recommendationModules: readonly ContentModuleCatalogEntry[];
  readonly regularModules: readonly ContentModuleCatalogEntry[];
  readonly filteredRecommendationModules: readonly ContentModuleCatalogEntry[];
  readonly regularSectionModules: (section: string) => readonly ContentModuleCatalogEntry[];
  readonly categoryModules: (categoryId: string) => readonly ContentModuleCatalogEntry[];
}

export function selectBulkDownloadModules(
  input: BulkDownloadSelectionInput,
): readonly ContentModuleCatalogEntry[] {
  if (input.coreLibraryOpen) {
    return [];
  }

  if (input.regularCollection) {
    return input.regularSectionModules(input.regularCollection);
  }

  if (input.recommendationBrowserOpen) {
    const query = input.catalogQuery.trim();
    if (query) {
      return input.filteredRecommendationModules;
    }
    if (input.recommendationCategory) {
      return input.categoryModules(input.recommendationCategory);
    }
    return input.recommendationModules;
  }

  return [...input.regularModules, ...input.recommendationModules];
}

export function estimateDownloadStorage(modules: readonly ContentModuleCatalogEntry[]): {
  readonly bytes: number;
  readonly incomplete: boolean;
} {
  let bytes = 0;
  let incomplete = false;
  for (const module of modules) {
    const size = module.sizes.installedBytes ?? module.sizes.downloadBytes;
    if (size === null) incomplete = true;
    else bytes += size;
  }
  return { bytes, incomplete };
}
