import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { BrowserContentModuleRuntime } from '@/features/modules/browser-module-runtime';
import {
  installPublishedCategoryModules,
  removeInstalledCategoryModules,
} from '@/features/modules/recommendation-category-operations';

function module(id: string): ContentModuleCatalogEntry {
  return {
    id,
    version: '1.0.0',
    kind: 'clinical',
    collection: 'minimed.clinical.test.ru',
    title: id,
    description: 'test',
    releaseState: 'published',
    required: false,
    tags: ['individual-recommendation'],
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
      downloadBytes: 1_000,
      installedBytes: 1_000,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
    },
    previewDocumentCount: 1,
    artifacts: [],
  };
}

function createRuntimeStub(): BrowserContentModuleRuntime {
  return {
    install: vi.fn((entry: ContentModuleCatalogEntry) => ({
      id: `task:${entry.id}`,
      moduleId: entry.id,
      version: entry.version,
      state: 'queued',
      downloadedBytes: 0,
      totalBytes: 1_000,
      includeSourceAssets: false,
      runsInBackground: false,
      errorMessage: null,
    })),
    wait: vi.fn(async (taskId: string) => ({
      id: taskId,
      moduleId: taskId.replace('task:', ''),
      version: '1.0.0',
      state: 'completed',
      downloadedBytes: 1_000,
      totalBytes: 1_000,
      includeSourceAssets: false,
      runsInBackground: false,
      errorMessage: null,
    })),
    remove: vi.fn(async () => undefined),
  } as unknown as BrowserContentModuleRuntime;
}

describe('recommendation-category-operations', () => {
  it('starts parallel installs for unpublished category modules', async () => {
    const runtime = createRuntimeStub();
    const modules = [module('a'), module('b')];

    const result = await installPublishedCategoryModules(runtime, modules, new Set(['a']));

    expect(runtime.install).toHaveBeenCalledTimes(1);
    expect(runtime.install).toHaveBeenCalledWith(modules[1]);
    expect(runtime.wait).toHaveBeenCalledWith('task:b');
    expect(result).toEqual({ changed: true, errorMessage: null });
  });

  it('removes installed category modules in parallel', async () => {
    const runtime = createRuntimeStub();
    const modules = [module('a'), module('b')];

    await removeInstalledCategoryModules(runtime, modules, new Set(['a', 'b']));

    expect(runtime.remove).toHaveBeenCalledTimes(2);
    expect(runtime.remove).toHaveBeenCalledWith('a');
    expect(runtime.remove).toHaveBeenCalledWith('b');
  });
});
