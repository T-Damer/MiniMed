import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { selectBulkDownloadModules } from './module-download-selection';

function module(id: string): ContentModuleCatalogEntry {
  return {
    id,
    version: '1.0.0',
    kind: 'clinical',
    collection: 'test',
    title: id,
    description: id,
    releaseState: 'published',
    required: false,
    tags: [],
    specialties: [],
    populations: [],
    compatibility: {
      minAppVersion: '0.3.3',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: `sha256:${'a'.repeat(64)}`,
    documents: [],
    dependencies: [],
    capabilities: {
      search: true,
      fullText: true,
      structuredTables: false,
      images: false,
      originalPdf: false,
      structuredKnowledge: false,
      calculations: false,
    },
    sizes: {
      downloadBytes: 1,
      installedBytes: 1,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
    },
    previewDocumentCount: 1,
    artifacts: [],
  };
}

function baseInput(
  overrides: Partial<Parameters<typeof selectBulkDownloadModules>[0]> = {},
): Parameters<typeof selectBulkDownloadModules>[0] {
  const recommendations = [module('recommendation')];
  const regular = [module('regular')];
  return {
    coreLibraryOpen: false,
    regularCollection: '',
    recommendationBrowserOpen: false,
    recommendationCategory: '',
    catalogQuery: '',
    recommendationModules: recommendations,
    regularModules: regular,
    filteredRecommendationModules: recommendations,
    regularSectionModules: (section) =>
      section === 'reference' ? [module('reference-section')] : regular,
    categoryModules: (categoryId) =>
      categoryId === 'cardiology' ? [module('cardiology')] : recommendations,
    ...overrides,
  };
}

describe('selectBulkDownloadModules', () => {
  it('returns nothing on the core library page', () => {
    expect(selectBulkDownloadModules(baseInput({ coreLibraryOpen: true }))).toEqual([]);
  });

  it('scopes to the open regular collection', () => {
    const scoped = selectBulkDownloadModules(baseInput({ regularCollection: 'reference' }));
    expect(scoped.map((entry) => entry.id)).toEqual(['reference-section']);
  });

  it('scopes to all recommendation modules on the recommendations overview', () => {
    const recommendations = [module('recommendation-a'), module('recommendation-b')];
    expect(
      selectBulkDownloadModules(
        baseInput({
          recommendationBrowserOpen: true,
          recommendationModules: recommendations,
        }),
      ),
    ).toBe(recommendations);
  });

  it('scopes to the active recommendation category', () => {
    const scoped = selectBulkDownloadModules(
      baseInput({
        recommendationBrowserOpen: true,
        recommendationCategory: 'cardiology',
      }),
    );
    expect(scoped.map((entry) => entry.id)).toEqual(['cardiology']);
  });

  it('scopes to filtered recommendation search results', () => {
    const filtered = [module('search-hit')];
    expect(
      selectBulkDownloadModules(
        baseInput({
          recommendationBrowserOpen: true,
          recommendationCategory: 'cardiology',
          catalogQuery: 'angina',
          filteredRecommendationModules: filtered,
        }),
      ),
    ).toBe(filtered);
  });

  it('scopes to regular modules on the documents overview', () => {
    const regular = [module('regular')];
    expect(selectBulkDownloadModules(baseInput({ regularModules: regular }))).toBe(regular);
  });
});
