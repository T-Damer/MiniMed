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

describe('selectBulkDownloadModules', () => {
  it('selects recommendation modules when the recommendation browser is open', () => {
    const recommendations = [module('recommendation')];
    const regular = [module('regular')];

    expect(selectBulkDownloadModules(true, recommendations, regular)).toBe(recommendations);
  });

  it('selects regular modules outside the recommendation browser', () => {
    const recommendations = [module('recommendation')];
    const regular = [module('regular')];

    expect(selectBulkDownloadModules(false, recommendations, regular)).toBe(regular);
  });
});
