import { describe, expect, it } from 'vitest';

import { ContentModuleCatalogEntrySchema, ContentModuleCatalogSchema } from '../src/content-modules';

const digest = `sha256:${'a'.repeat(64)}`;
const artifactDigest = `sha256:${'b'.repeat(64)}`;

function moduleFixture() {
  return {
    id: 'minimed.core.ru',
    version: '1.0.0',
    kind: 'core' as const,
    collection: 'core',
    title: 'Ядро MiniMed',
    description: 'Глобальный каталог тем и маршрутизация к модулям.',
    required: true,
    releaseState: 'bundled' as const,
    specialties: [],
    populations: ['all'],
    tags: ['catalog'],
    compatibility: {
      minAppVersion: '0.3.1',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: digest,
    dependencies: [],
    sizes: {
      downloadBytes: 0,
      installedBytes: 128_000,
      sourceAssetsDownloadBytes: null,
      precision: 'estimate' as const,
    },
    capabilities: {
      search: true,
      fullText: false,
      structuredTables: false,
      images: false,
      originalPdf: false,
      structuredKnowledge: true,
      calculations: false,
    },
    artifacts: [],
    documents: [],
    previewDocumentCount: 0,
  };
}

describe('content module catalog contracts', () => {
  it('accepts a core catalog with planned modules', () => {
    const core = moduleFixture();
    const planned = {
      ...moduleFixture(),
      id: 'minimed.clinical.pediatrics.infectious',
      kind: 'clinical' as const,
      collection: 'pediatrics',
      title: 'Детские инфекции',
      required: false,
      releaseState: 'planned' as const,
      dependencies: [{ moduleId: core.id, versionRange: '^1.0.0', required: true }],
    };

    const result = ContentModuleCatalogSchema.parse({
      catalogVersion: '1',
      channel: 'preview',
      publishedAt: '2026-07-21T00:00:00Z',
      modules: [core, planned],
    });

    expect(result.modules).toHaveLength(2);
  });

  it('rejects an artifact built from another source set', () => {
    const value = moduleFixture();
    const result = ContentModuleCatalogEntrySchema.safeParse({
      ...value,
      artifacts: [
        {
          id: 'index',
          kind: 'index',
          required: true,
          url: null,
          sha256: null,
          sizeBytes: null,
          compression: 'zstd',
          sourceSetDigest: artifactDigest,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects self-dependencies', () => {
    const value = moduleFixture();
    const result = ContentModuleCatalogEntrySchema.safeParse({
      ...value,
      dependencies: [{ moduleId: value.id, versionRange: '^1.0.0', required: true }],
    });

    expect(result.success).toBe(false);
  });

  it('requires downloadable checksummed index artifacts for published modules', () => {
    const value = moduleFixture();
    const result = ContentModuleCatalogEntrySchema.safeParse({
      ...value,
      id: 'minimed.medications.ru',
      kind: 'medication',
      required: false,
      releaseState: 'published',
      artifacts: [
        {
          id: 'index',
          kind: 'index',
          required: true,
          url: null,
          sha256: null,
          sizeBytes: null,
          compression: 'zstd',
          sourceSetDigest: digest,
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
