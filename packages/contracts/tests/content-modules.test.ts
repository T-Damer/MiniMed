import { describe, expect, it } from 'vitest';

import {
  ContentModuleCatalogEntrySchema,
  ContentModuleCatalogSchema,
  hasDownloadableModuleIndex,
  serializeContentModuleCatalog,
} from '../src/content-modules';

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

function catalog(modules: readonly ReturnType<typeof moduleFixture>[]) {
  return {
    catalogVersion: '1',
    channel: 'preview' as const,
    publishedAt: '2026-07-21T00:00:00Z',
    modules,
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

    const result = ContentModuleCatalogSchema.parse(catalog([core, planned]));

    expect(result.modules).toHaveLength(2);
    expect(result.categories).toEqual([]);
  });

  it('rejects duplicate module IDs', () => {
    const core = moduleFixture();
    const result = ContentModuleCatalogSchema.safeParse(catalog([core, { ...core }]));

    expect(result.success).toBe(false);
  });

  it('rejects missing dependency targets', () => {
    const core = moduleFixture();
    const planned = {
      ...moduleFixture(),
      id: 'minimed.clinical.pediatrics.infectious',
      kind: 'clinical' as const,
      required: false,
      dependencies: [{ moduleId: 'minimed.core.missing', versionRange: '^1.0.0', required: true }],
    };
    const result = ContentModuleCatalogSchema.safeParse(catalog([core, planned]));

    expect(result.success).toBe(false);
  });

  it('rejects catalogs without a required core', () => {
    const module = {
      ...moduleFixture(),
      id: 'minimed.medications.ru',
      kind: 'medication' as const,
      required: false,
    };
    const result = ContentModuleCatalogSchema.safeParse(catalog([module]));

    expect(result.success).toBe(false);
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

  it('accepts tool kind modules', () => {
    const value = moduleFixture();
    const result = ContentModuleCatalogEntrySchema.safeParse({
      ...value,
      id: 'minimed.tools.gastroenterology.ru',
      kind: 'tool' as const,
      collection: 'tool',
      title: 'Инструменты гастроэнтерологии',
      required: false,
      releaseState: 'planned' as const,
      toolCount: 3,
    });

    expect(result.success).toBe(true);
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

describe('downloadable index eligibility', () => {
  const index = {
    id: 'index',
    kind: 'index' as const,
    required: true,
    compression: 'none' as const,
    url: 'https://example.test/index.db',
    sha256: artifactDigest,
    sizeBytes: 128,
    sourceSetDigest: digest,
  };
  const prepared = { ...moduleFixture(), artifacts: [index] };
  it('requires one required checksummed index of the declared source set', () => {
    expect(hasDownloadableModuleIndex(prepared)).toBe(true);
    expect(hasDownloadableModuleIndex({ ...prepared, artifacts: [] })).toBe(false);
    expect(
      hasDownloadableModuleIndex({ ...prepared, artifacts: [index, { ...index, id: 'other' }] }),
    ).toBe(false);
    expect(
      hasDownloadableModuleIndex({ ...prepared, artifacts: [{ ...index, required: false }] }),
    ).toBe(false);
    expect(hasDownloadableModuleIndex({ ...prepared, artifacts: [{ ...index, url: null }] })).toBe(
      false,
    );
    expect(
      hasDownloadableModuleIndex({ ...prepared, artifacts: [{ ...index, sha256: null }] }),
    ).toBe(false);
    expect(hasDownloadableModuleIndex({ ...prepared, sourceSetDigest: artifactDigest })).toBe(
      false,
    );
  });
  it('keeps unbuilt previews as discovery metadata, not downloadable releases', () => {
    const preview = { ...moduleFixture(), releaseState: 'preview' as const };
    expect(ContentModuleCatalogEntrySchema.safeParse(preview).success).toBe(true);
    expect(hasDownloadableModuleIndex(preview)).toBe(false);
    expect(
      ContentModuleCatalogEntrySchema.safeParse({ ...preview, releaseState: 'published' }).success,
    ).toBe(false);
  });
  it('rejects missing mandatory source artifacts without requiring optional sources', () => {
    const source = { ...index, id: 'source', kind: 'source-assets' as const, url: null };
    expect(hasDownloadableModuleIndex({ ...prepared, artifacts: [index, source] })).toBe(false);
    expect(
      hasDownloadableModuleIndex({
        ...prepared,
        artifacts: [index, { ...source, required: false }],
      }),
    ).toBe(true);
  });
});

describe('compact catalog membership', () => {
  const index = {
    id: 'minimed.mkb.ru-index',
    kind: 'index' as const,
    required: true,
    compression: 'none' as const,
    url: 'https://example.test/index.db',
    sha256: artifactDigest,
    sizeBytes: 128,
    sourceSetDigest: digest,
  };
  const assets = { ...index, id: 'minimed.mkb.ru-assets', kind: 'source-assets' as const };
  const documents = [
    {
      documentId: 'rls.mkb.a00',
      documentVersionId: 'rls.mkb.a00@rls-1',
      sourceChecksum: `sha256:${'c'.repeat(64)}`,
      status: 'active' as const,
      indexArtifactId: index.id,
      sourceAssetArtifactId: null,
      title: 'Холера',
    },
    {
      documentId: 'rls.mkb.a01',
      documentVersionId: 'other-version-id',
      sourceChecksum: `sha256:${'d'.repeat(64)}`,
      status: 'superseded' as const,
      indexArtifactId: index.id,
      sourceAssetArtifactId: assets.id,
      title: null,
    },
  ];
  const withDocuments = () =>
    catalog([
      { ...moduleFixture(), artifacts: [index, assets], documents, previewDocumentCount: 2 },
    ]);

  it('writes rows and parses back to the same documents in the same order', () => {
    const text = serializeContentModuleCatalog(withDocuments());
    const written = JSON.parse(text) as { modules: Record<string, unknown>[] };
    expect(written.modules[0]).not.toHaveProperty('documents');
    expect(written.modules[0]?.['documentTable']).toEqual({
      indexArtifactId: index.id,
      rows: [
        ['rls.mkb.a00', '@rls-1', 'c'.repeat(64), 'Холера'],
        [
          'rls.mkb.a01',
          'other-version-id',
          'd'.repeat(64),
          null,
          { status: 'superseded', sourceAssetArtifactId: assets.id },
        ],
      ],
    });
    expect(ContentModuleCatalogSchema.parse(written).modules[0]?.documents).toEqual(documents);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\n  ');
  });

  it('lets a fresh documents array replace an older table', () => {
    const compact = JSON.parse(serializeContentModuleCatalog(withDocuments())) as {
      modules: Record<string, unknown>[];
    };
    const hydrated = {
      ...compact,
      modules: [{ ...compact.modules[0], documents: [documents[0]] }],
    };
    const reparsed = ContentModuleCatalogSchema.parse(
      JSON.parse(serializeContentModuleCatalog(hydrated)),
    );
    expect(reparsed.modules[0]?.documents).toEqual([documents[0]]);
  });

  it('rejects a module that lists both forms or a malformed table', () => {
    const module = { ...moduleFixture(), artifacts: [index] };
    const table = {
      indexArtifactId: index.id,
      rows: [['rls.mkb.a00', '@v', 'c'.repeat(64), null]],
    };
    expect(
      ContentModuleCatalogEntrySchema.safeParse({ ...module, documentTable: table }).success,
    ).toBe(false);
    const { documents: _documents, ...withoutDocuments } = module;
    expect(
      ContentModuleCatalogEntrySchema.safeParse({ ...withoutDocuments, documentTable: table })
        .success,
    ).toBe(true);
    expect(
      ContentModuleCatalogEntrySchema.safeParse({
        ...withoutDocuments,
        documentTable: { indexArtifactId: index.id, rows: [['rls.mkb.a00', '@v', 'short', null]] },
      }).success,
    ).toBe(false);
  });
});
