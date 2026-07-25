import type { ContentModuleCatalog } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { contentModuleCatalogFingerprint } from '@/features/modules/module-runtime-service';

function catalog(version: string, checksum: string): ContentModuleCatalog {
  return {
    catalogVersion: `catalog-${version}`,
    channel: 'preview',
    publishedAt: '2026-07-25T00:00:00Z',
    categories: [],
    modules: [
      {
        id: 'minimed.test.module',
        version,
        kind: 'clinical',
        collection: 'test',
        title: 'Test',
        description: 'Test module',
        required: false,
        releaseState: 'published',
        specialties: [],
        populations: ['all'],
        tags: [],
        compatibility: {
          minAppVersion: '0.1.0',
          maxAppVersion: null,
          schemaVersion: 2,
          coreCatalogVersion: '1',
        },
        sourceSetDigest: checksum,
        dependencies: [],
        sizes: {
          downloadBytes: 12,
          installedBytes: 12,
          sourceAssetsDownloadBytes: null,
          precision: 'exact',
        },
        capabilities: {
          search: true,
          fullText: true,
          structuredTables: false,
          images: false,
          originalPdf: false,
          structuredKnowledge: false,
          calculations: false,
        },
        artifacts: [
          {
            id: 'index',
            kind: 'index',
            required: true,
            url: `https://example.test/${version}.db`,
            sha256: checksum,
            sizeBytes: 12,
            mediaType: 'application/vnd.sqlite3',
            compression: 'none',
          },
        ],
        documents: [],
        previewDocumentCount: 1,
      },
    ],
  };
}

describe('contentModuleCatalogFingerprint', () => {
  it('changes when a same-sized catalog publishes a new module version', () => {
    const first = catalog('1.0.0', `sha256:${'a'.repeat(64)}`);
    const second = catalog('1.0.1', `sha256:${'b'.repeat(64)}`);

    expect(first.modules).toHaveLength(second.modules.length);
    expect(contentModuleCatalogFingerprint(first)).not.toBe(
      contentModuleCatalogFingerprint(second),
    );
  });

  it('is stable for equivalent catalog content', () => {
    const first = catalog('1.0.0', `sha256:${'a'.repeat(64)}`);
    const second = catalog('1.0.0', `sha256:${'a'.repeat(64)}`);

    expect(contentModuleCatalogFingerprint(first)).toBe(contentModuleCatalogFingerprint(second));
  });
});
