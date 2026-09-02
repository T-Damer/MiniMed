import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  InstalledContentModule,
} from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  installModulePointer,
  type ModulePointerDescriptor,
  type ModulePointerRuntime,
  parseModulePointerMetadata,
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
    artifacts: [],
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
