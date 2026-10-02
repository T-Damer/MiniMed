import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  InstalledContentModule,
} from '@localmed/contracts';
import { ContentModuleCatalogEntrySchema } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  assertIdentityDocumentTarget,
  catalogContainsIdentityDocumentTarget,
  installModulePointer,
  type ModulePointerDescriptor,
  type ModulePointerRuntime,
  modulePointerTargetAnchor,
  parseModulePointerMetadata,
  resolveCatalogDocumentPointer,
  resolveModulePointer,
  selectModuleForPointer,
} from '@/features/modules/module-pointer-install';

const CHECKSUM = `sha256:${'a'.repeat(64)}`;

function moduleEntry(
  id: string,
  documentIds: readonly string[],
  releaseState: ContentModuleCatalogEntry['releaseState'] = 'published',
): ContentModuleCatalogEntry {
  return {
    id,
    version: '1.0.0',
    kind: 'clinical',
    collection: 'test',
    title: `Набор ${id}`,
    description: 'Тестовый набор',
    required: false,
    releaseState,
    specialties: [],
    populations: [],
    tags: [],
    compatibility: {
      minAppVersion: '0.1.0',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: CHECKSUM,
    dependencies: [],
    sizes: {
      downloadBytes: 100,
      installedBytes: 100,
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
        url: 'https://example.com/index.db',
        sha256: CHECKSUM,
        sizeBytes: 100,
        compression: 'none',
        sourceSetDigest: CHECKSUM,
      },
    ],
    documents: documentIds.map((documentId) => ({
      documentId,
      documentVersionId: `${documentId}@1`,
      sourceChecksum: CHECKSUM,
      status: 'active',
      indexArtifactId: 'index',
      sourceAssetArtifactId: null,
      title: documentId,
    })),
    previewDocumentCount: documentIds.length,
  };
}

function catalog(modules: readonly ContentModuleCatalogEntry[]): ContentModuleCatalog {
  return {
    catalogVersion: 'test',
    channel: 'preview',
    publishedAt: '2026-08-31T00:00:00Z',
    categories: [],
    modules: [...modules],
  };
}

function pointer(overrides: Partial<ModulePointerDescriptor> = {}): ModulePointerDescriptor {
  return {
    contentMode: 'module-pointer',
    targetDocumentId: 'target.document',
    primaryModuleId: 'primary',
    moduleIds: ['primary', 'fallback'],
    ...overrides,
  };
}

function task(state: ContentModuleDownloadTask['state']): ContentModuleDownloadTask {
  return {
    id: 'task-1',
    moduleId: 'primary',
    version: '1.0.0',
    state,
    downloadedBytes: state === 'completed' ? 100 : 0,
    totalBytes: 100,
    includeSourceAssets: false,
    runsInBackground: false,
    errorMessage: state === 'failed' ? 'Сервер недоступен' : null,
  };
}

describe('module-pointer-install', () => {
  it('resolves an absent document only through exact verified catalog membership', () => {
    expect(
      resolveCatalogDocumentPointer(
        'target.document',
        catalog([moduleEntry('primary', ['target.document'])]),
        [],
      )?.state,
    ).toBe('available');
    expect(
      resolveCatalogDocumentPointer(
        'unknown',
        catalog([moduleEntry('primary', ['target.document'])]),
        [],
      ),
    ).toBeNull();
    expect(
      resolveCatalogDocumentPointer(
        'target.document',
        catalog([{ ...moduleEntry('primary', ['target.document']), artifacts: [] }]),
        [],
      )?.state,
    ).toBe('unavailable');
    expect(
      resolveCatalogDocumentPointer(
        'target.document',
        catalog([moduleEntry('primary', ['target.document'], 'planned')]),
        [],
      )?.state,
    ).toBe('unavailable');
  });

  it('validates the exact source identity release, version, checksum and index', () => {
    const target = {
      type: 'document' as const,
      moduleId: 'primary',
      moduleVersion: '1.0.0',
      documentId: 'target.document',
      documentVersionId: 'target.document@1',
      sourceChecksum: CHECKSUM,
      anchor: 'source-anchor',
    };
    const modules = catalog([moduleEntry('primary', ['target.document'])]);
    expect(catalogContainsIdentityDocumentTarget(target, modules)).toBe(true);
    const splitMembership = moduleEntry('primary', ['target.document']);
    const [indexArtifact] = splitMembership.artifacts;
    const [membership] = splitMembership.documents;
    if (!indexArtifact || !membership) throw new Error('Expected fixture membership and artifact');
    const sourceAsset = {
      ...indexArtifact,
      id: 'source',
      kind: 'source-assets' as const,
      required: false,
    };
    const misleading = {
      ...splitMembership,
      artifacts: [...splitMembership.artifacts, sourceAsset],
      documents: [
        { ...membership, indexArtifactId: 'source' },
        {
          ...membership,
          documentVersionId: 'other-edition',
          sourceChecksum: `sha256:${'b'.repeat(64)}`,
        },
      ],
    };
    expect(
      catalogContainsIdentityDocumentTarget(
        target,
        catalog([ContentModuleCatalogEntrySchema.parse(misleading)]),
      ),
    ).toBe(false);
    const otherEdition = moduleEntry('other', ['target.document']);
    otherEdition.documents = otherEdition.documents.map((document) => ({
      ...document,
      documentVersionId: 'other-version',
      sourceChecksum: `sha256:${'b'.repeat(64)}`,
    }));
    const overlapping = catalog([otherEdition, ...modules.modules]);
    expect(resolveCatalogDocumentPointer('target.document', overlapping, [])?.module?.id).toBe(
      'other',
    );
    expect(
      resolveCatalogDocumentPointer('target.document', overlapping, [], target)?.module?.id,
    ).toBe('primary');
    expect(
      resolveCatalogDocumentPointer('target.document', catalog([otherEdition]), [], target),
    ).toBeNull();
    const actual = {
      id: target.documentId,
      versionId: target.documentVersionId,
      sourceChecksum: target.sourceChecksum,
    };
    expect(() => assertIdentityDocumentTarget(actual, target)).not.toThrow();
    expect(() => assertIdentityDocumentTarget({ ...actual, versionId: 'other' }, target)).toThrow(
      'другой редакции',
    );
    expect(() =>
      assertIdentityDocumentTarget(
        { ...actual, sourceChecksum: `sha256:${'b'.repeat(64)}` },
        target,
      ),
    ).toThrow('другой редакции');
    expect(
      catalogContainsIdentityDocumentTarget({ ...target, moduleVersion: '2.0.0' }, modules),
    ).toBe(false);
    expect(
      catalogContainsIdentityDocumentTarget({ ...target, documentVersionId: 'other' }, modules),
    ).toBe(false);
    expect(
      catalogContainsIdentityDocumentTarget(
        { ...target, sourceChecksum: `sha256:${'b'.repeat(64)}` },
        modules,
      ),
    ).toBe(false);
    expect(
      catalogContainsIdentityDocumentTarget(
        target,
        catalog([{ ...moduleEntry('primary', ['target.document']), artifacts: [] }]),
      ),
    ).toBe(false);
  });

  it('parses and normalizes a core module pointer', () => {
    expect(
      parseModulePointerMetadata({
        contentMode: 'module-pointer',
        targetDocumentId: 'target.document',
        primaryModuleId: 'primary',
        moduleIds: ['fallback', 'primary'],
      }),
    ).toEqual(pointer());
    expect(parseModulePointerMetadata({ contentMode: 'module-pointer' })).toBeNull();
  });

  it('selects the primary module only when it contains the exact target', () => {
    const selected = selectModuleForPointer(
      pointer(),
      catalog([
        moduleEntry('primary', ['other.document']),
        moduleEntry('fallback', ['target.document']),
      ]),
    );
    expect(selected?.id).toBe('fallback');
  });

  it('finds a target among thousands of module documents, including a repeated membership', () => {
    const large = moduleEntry('primary', [
      ...Array.from({ length: 5_000 }, (_, index) => `other.${index}`),
      'target.document',
      'target.document',
    ]);
    const [unindexed] = large.documents.filter(
      (document) => document.documentId === 'target.document',
    );
    if (!unindexed) throw new Error('Expected the target membership');
    const documents = large.documents.map((document) =>
      document === unindexed ? { ...document, indexArtifactId: 'missing' } : document,
    );
    // The first membership names no index; the second one still verifies the target.
    expect(selectModuleForPointer(pointer(), catalog([{ ...large, documents }]))?.id).toBe(
      'primary',
    );
    expect(
      selectModuleForPointer(pointer({ targetDocumentId: 'absent' }), catalog([large])),
    ).toBeNull();
  });

  it('rejects unverified membership and missing index artifacts', () => {
    expect(selectModuleForPointer(pointer(), catalog([moduleEntry('primary', [])]))).toBeNull();
    expect(
      selectModuleForPointer(
        pointer(),
        catalog([{ ...moduleEntry('primary', ['target.document']), artifacts: [] }]),
      ),
    ).toBeNull();
  });

  it('uses a released alternative when the primary is unavailable', () => {
    expect(
      selectModuleForPointer(
        pointer(),
        catalog([
          moduleEntry('primary', ['target.document'], 'planned'),
          moduleEntry('fallback', ['target.document']),
        ]),
      )?.id,
    ).toBe('fallback');
  });

  it('falls back to any released module with exact membership when no declared id ships it', () => {
    const undeclared = catalog([
      moduleEntry('primary', ['other.document']),
      moduleEntry('published.later', ['target.document']),
    ]);
    expect(selectModuleForPointer(pointer(), undeclared)?.id).toBe('published.later');
    // A declared module that holds the target still wins over an undeclared one.
    expect(
      selectModuleForPointer(
        pointer(),
        catalog([
          moduleEntry('published.later', ['target.document']),
          moduleEntry('fallback', ['target.document']),
        ]),
      )?.id,
    ).toBe('fallback');
    // Membership stays exact: an undeclared module without the target is never offered.
    expect(
      selectModuleForPointer(pointer(), catalog([moduleEntry('published.later', ['x'])])),
    ).toBeNull();
  });

  it('maps a local definition excerpt back to its original source anchor', () => {
    const metadata = {
      definitionPreviewAnchor: 'preview#definition',
      canonicalDefinition: { sourceAnchor: 'source#paragraph' },
    };
    expect(modulePointerTargetAnchor(metadata, 'preview#definition')).toBe('source#paragraph');
    expect(modulePointerTargetAnchor(metadata, 'source#other')).toBe('source#other');
  });

  it('reports available, installed, and unavailable pointer states', () => {
    const selectedCatalog = catalog([moduleEntry('primary', ['target.document'])]);
    expect(resolveModulePointer(pointer(), selectedCatalog, []).state).toBe('available');

    const installed: InstalledContentModule = {
      moduleId: 'primary',
      version: '1.0.0',
      state: 'installed',
      enabled: true,
      installedAt: '2026-08-31T00:00:00Z',
      installedSizeBytes: 100,
      activeSourceSetDigest: CHECKSUM,
      previousVersions: [],
      lastValidation: null,
    };
    expect(resolveModulePointer(pointer(), selectedCatalog, [installed]).state).toBe('installed');
    expect(resolveModulePointer(pointer(), catalog([]), []).message).toContain('не найден');
  });

  it('waits for the selected module and forwards progress', async () => {
    const completed = task('completed');
    const runtime: ModulePointerRuntime = {
      install: vi.fn(() => task('queued')),
      wait: vi.fn(async () => completed),
      subscribe: vi.fn(() => () => undefined),
    };
    const progress: Array<number | null> = [];

    await expect(
      installModulePointer(
        runtime,
        resolveModulePointer(pointer(), catalog([moduleEntry('primary', ['target.document'])]), []),
        (value) => progress.push(value),
      ),
    ).resolves.toEqual(completed);
    expect(runtime.install).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'primary', version: '1.0.0' }),
    );
    expect(progress).toEqual([0, 1]);
  });

  it('surfaces a failed install and never hides the error', async () => {
    const runtime: ModulePointerRuntime = {
      install: vi.fn(() => task('queued')),
      wait: vi.fn(async () => task('failed')),
      subscribe: vi.fn(() => () => undefined),
    };
    const resolution = resolveModulePointer(
      pointer(),
      catalog([moduleEntry('primary', ['target.document'])]),
      [],
    );

    await expect(installModulePointer(runtime, resolution)).rejects.toThrow('Сервер недоступен');
  });
});

it('maps a term occurrence to its exact source anchor without changing unrelated anchors', () => {
  const metadata = { terminologyMentionAnchors: { 'core#term-one': 'source@1/section#chunk-7' } };
  expect(modulePointerTargetAnchor(metadata, 'core#term-one')).toBe('source@1/section#chunk-7');
  expect(modulePointerTargetAnchor(metadata, 'other#anchor')).toBe('other#anchor');
  expect(modulePointerTargetAnchor(metadata, '__proto__')).toBe('__proto__');
  expect(modulePointerTargetAnchor({ terminologyMentionAnchors: { invalid: 1 } }, 'invalid')).toBe(
    'invalid',
  );
});

it('does not treat a local discovery definition anchor as a detail-package source anchor', () => {
  expect(modulePointerTargetAnchor({ pointerKind: 'terminology' }, 'core#definition')).toBeNull();
});

it('opens the verified original at its start for a synthetic classification excerpt only', () => {
  const anchor = 'core.pointer.A00@2026.9.30/классификационный-контекст#chunk-0bf390fe';
  const target = {
    id: 'reference.rls.A00',
    versionId: 'reference.rls.A00@2026.9.30',
    sourceChecksum: CHECKSUM,
  };
  const metadata = {
    contentMode: 'module-pointer',
    targetDocumentId: target.id,
    sourceDocumentId: target.id,
    sourceDocumentVersionId: target.versionId,
    sourceChecksum: CHECKSUM,
  };
  const source = {
    pointer: {
      versionId: 'core.pointer.A00@2026.9.30',
      sections: [{ anchor: 'local-section', chunks: [{ anchor }] }],
    },
    target,
  };
  expect(modulePointerTargetAnchor(metadata, anchor, source)).toBeNull();
  expect(modulePointerTargetAnchor(metadata, 'foreign@1/section', source)).toBe(
    'foreign@1/section',
  );
  expect(modulePointerTargetAnchor(metadata, `${source.pointer.versionId}/unknown`, source)).toBe(
    `${source.pointer.versionId}/unknown`,
  );
  expect(
    modulePointerTargetAnchor({ ...metadata, sourceChecksum: 'sha256:other' }, anchor, source),
  ).toBe(anchor);
  expect(
    modulePointerTargetAnchor(
      { ...metadata, sourceDocumentVersionId: 'other@edition' },
      anchor,
      source,
    ),
  ).toBe(anchor);
  expect(
    modulePointerTargetAnchor(
      { ...metadata, terminologyMentionAnchors: { [anchor]: 'original@1/paragraph' } },
      anchor,
      source,
    ),
  ).toBe('original@1/paragraph');
});
