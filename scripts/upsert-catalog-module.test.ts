import { describe, expect, it } from 'bun:test';

import { upsertCatalogModule } from './upsert-catalog-module';

const digest = `sha256:${'a'.repeat(64)}`;
const module = (id: string, version: string, extra: Record<string, unknown> = {}) => ({
  id,
  version,
  kind: id === 'minimed.core.ru' ? 'core' : 'reference',
  collection: 'shared',
  title: id,
  description: id,
  required: id === 'minimed.core.ru',
  releaseState: 'preview',
  compatibility: { minAppVersion: '0.6.44', schemaVersion: 2, coreCatalogVersion: '1' },
  sourceSetDigest: digest,
  sizes: {},
  capabilities: {
    search: true,
    fullText: true,
    structuredTables: false,
    images: false,
    originalPdf: false,
    structuredKnowledge: false,
    calculations: false,
  },
  ...extra,
});
const catalog = {
  catalogVersion: 'test',
  channel: 'preview',
  publishedAt: '2026-09-28T00:00:00Z',
  modules: [module('minimed.core.ru', '1'), module('minimed.mkb.ru', '1')],
};

describe('upsertCatalogModule', () => {
  it('replaces a module with the same id in place and keeps the others unchanged', () => {
    const next = upsertCatalogModule(catalog, module('minimed.mkb.ru', '2'));
    expect(next['modules']).toEqual([
      module('minimed.core.ru', '1'),
      module('minimed.mkb.ru', '2'),
    ]);
  });

  it('appends a new module id', () => {
    const next = upsertCatalogModule(catalog, module('minimed.other.ru', '1'));
    expect((next['modules'] as { id: string }[]).map((entry) => entry.id)).toEqual([
      'minimed.core.ru',
      'minimed.mkb.ru',
      'minimed.other.ru',
    ]);
  });

  it('rejects a descriptor whose membership names a missing artifact', () => {
    const broken = module('minimed.mkb.ru', '2', {
      documents: [
        {
          documentId: 'd',
          documentVersionId: 'd@1',
          sourceChecksum: digest,
          status: 'active',
          indexArtifactId: 'missing',
        },
      ],
    });
    expect(() => upsertCatalogModule(catalog, broken)).toThrow();
  });
});
