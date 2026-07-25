import type { ContentModuleCatalogEntry, ContentModuleCategory } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  modulesInCategory,
  recommendationCategoryDownloadProgress,
  recommendationCategoryStats,
} from '@/features/modules/recommendation-categories';

const category: ContentModuleCategory = {
  id: 'minimed.clinical.respiratory-allergy.ru',
  title: 'Пульмонология',
  recommendationCount: 2,
  specialties: ['pulmonology'],
};

function module(
  id: string,
  overrides: Partial<ContentModuleCatalogEntry> = {},
): ContentModuleCatalogEntry {
  return {
    id,
    version: '1.0.0',
    kind: 'clinical',
    collection: category.id,
    title: id,
    description: 'test',
    releaseState: 'published',
    required: false,
    tags: ['individual-recommendation', category.id],
    specialties: ['pulmonology'],
    populations: ['Взрослые'],
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
      downloadBytes: 1_000_000,
      installedBytes: 1_000_000,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
    },
    previewDocumentCount: 1,
    artifacts: [],
    ...overrides,
  };
}

describe('recommendation-categories', () => {
  it('matches modules by collection or category tag', () => {
    const modules = [
      module('a'),
      module('b', { collection: 'other', tags: ['individual-recommendation', category.id] }),
      module('c', { collection: 'other', tags: ['individual-recommendation'] }),
    ];

    expect(modulesInCategory(modules, category.id).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('summarizes installed and pending category modules', () => {
    const modules = [module('a'), module('b'), module('c', { releaseState: 'planned' })];

    const stats = recommendationCategoryStats(modules, category, new Set(['a']));

    expect(stats).toEqual({
      publishedCount: 2,
      installedCount: 1,
      pendingCount: 1,
      downloadBytes: 2_000_000,
    });
  });

  it('aggregates active download progress for a category', () => {
    const modules = [module('a'), module('b')];
    const progress = recommendationCategoryDownloadProgress(modules, category.id, new Set(['a']), [
      {
        id: 'task-1',
        moduleId: 'b',
        version: '1.0.0',
        state: 'downloading',
        downloadedBytes: 500_000,
        totalBytes: 1_000_000,
        includeSourceAssets: false,
        runsInBackground: false,
        errorMessage: null,
      },
    ]);

    expect(progress).toEqual({
      publishedCount: 2,
      installedCount: 1,
      activeTaskCount: 1,
      installedFraction: 0.5,
      byteProgress: 0.5,
    });
  });
});
