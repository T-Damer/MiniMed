import type {
  ContentModuleArtifactSchema,
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
} from '@localmed/contracts';
import {
  type ContentModuleActivationReceipt,
  type ContentModuleArtifactBackend,
  type ContentModuleArtifactDownloader,
  type ContentModuleIndexValidator,
  ForegroundContentModuleInstaller,
  type StagedContentModuleArtifact,
} from '@localmed/core';
import {
  InMemoryInstalledModuleRegistry,
  type ModuleVersionInstallation,
} from '@localmed/storage';
import type { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

type Artifact = z.infer<typeof ContentModuleArtifactSchema>;

const sourceSetDigest = `sha256:${'a'.repeat(64)}`;

async function checksum(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(value)]
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function moduleFixture(options: {
  readonly indexBytes: Uint8Array;
  readonly sourceBytes?: Uint8Array;
}): Promise<{ catalog: ContentModuleCatalog; module: ContentModuleCatalogEntry }> {
  const artifacts: Artifact[] = [
    {
      id: 'index',
      kind: 'index',
      required: true,
      url: 'https://example.test/index.sqlite',
      sha256: await checksum(options.indexBytes),
      sizeBytes: options.indexBytes.byteLength,
      compression: 'none',
      sourceSetDigest,
    },
  ];
  if (options.sourceBytes) {
    artifacts.push({
      id: 'sources',
      kind: 'source-assets',
      required: false,
      url: 'https://example.test/sources.zip',
      sha256: await checksum(options.sourceBytes),
      sizeBytes: options.sourceBytes.byteLength,
      compression: 'zip',
      sourceSetDigest,
    });
  }

  const core: ContentModuleCatalogEntry = {
    id: 'minimed.core.ru',
    version: '1.0.0',
    kind: 'core',
    collection: 'core',
    title: 'Ядро',
    description: 'Обязательное ядро.',
    required: true,
    releaseState: 'bundled',
    specialties: [],
    populations: ['all'],
    tags: [],
    compatibility: {
      minAppVersion: '0.3.1',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest: null,
    dependencies: [],
    sizes: {
      downloadBytes: 0,
      installedBytes: 1,
      sourceAssetsDownloadBytes: null,
      precision: 'exact',
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

  const module: ContentModuleCatalogEntry = {
    id: 'minimed.clinical.pediatrics.infectious',
    version: '1.0.0',
    kind: 'clinical',
    collection: 'pediatrics',
    title: 'Детские инфекции',
    description: 'Полнотекстовый модуль.',
    required: false,
    releaseState: 'published',
    specialties: ['pediatrics'],
    populations: ['children'],
    tags: ['infection'],
    compatibility: {
      minAppVersion: '0.3.1',
      maxAppVersion: null,
      schemaVersion: 2,
      coreCatalogVersion: '1',
    },
    sourceSetDigest,
    dependencies: [{ moduleId: core.id, versionRange: '^1.0.0', required: true }],
    sizes: {
      downloadBytes: options.indexBytes.byteLength,
      installedBytes: null,
      sourceAssetsDownloadBytes: options.sourceBytes?.byteLength ?? null,
      precision: 'exact',
    },
    capabilities: {
      search: true,
      fullText: true,
      structuredTables: true,
      images: Boolean(options.sourceBytes),
      originalPdf: Boolean(options.sourceBytes),
      structuredKnowledge: true,
      calculations: false,
    },
    artifacts,
    documents: [],
    previewDocumentCount: 0,
  };

  return {
    module,
    catalog: {
      catalogVersion: '1',
      channel: 'preview',
      publishedAt: '2026-07-21T00:00:00Z',
      modules: [core, module],
    },
  };
}

function validatedInstallation(moduleId = 'minimed.core.ru'): ModuleVersionInstallation {
  return {
    moduleId,
    version: '1.0.0',
    required: moduleId === 'minimed.core.ru',
    installedAt: '2026-07-21T00:00:00Z',
    installedSizeBytes: 1,
    sourceSetDigest: `sha256:${'b'.repeat(64)}`,
    validation: {
      checkedAt: '2026-07-21T00:00:00Z',
      valid: true,
      checksumValid: true,
      schemaCompatible: true,
      sqliteIntegrity: 'ok',
      message: 'ok',
    },
  };
}

class TestDownloader implements ContentModuleArtifactDownloader {
  public readonly calls: string[] = [];

  public constructor(private readonly bytes: Readonly<Record<string, Uint8Array>>) {}

  public async download(
    artifact: Artifact,
    signal: AbortSignal,
    onProgress: (progress: { downloadedBytes: number; totalBytes: number | null }) => void,
  ): Promise<Uint8Array> {
    if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    this.calls.push(artifact.id);
    const value = this.bytes[artifact.id];
    if (!value) throw new Error(`missing ${artifact.id}`);
    onProgress({ downloadedBytes: value.byteLength, totalBytes: value.byteLength });
    return value;
  }
}

class TestBackend implements ContentModuleArtifactBackend {
  public readonly staged: string[] = [];
  public discarded = false;
  public restored = false;
  public activated = false;

  public async stage(
    _module: ContentModuleCatalogEntry,
    artifact: Artifact,
    bytes: Uint8Array,
  ): Promise<StagedContentModuleArtifact> {
    this.staged.push(artifact.id);
    return {
      artifactId: artifact.id,
      kind: artifact.kind,
      sizeBytes: bytes.byteLength,
      token: `stage:${artifact.id}`,
    };
  }

  public async activate(
    module: ContentModuleCatalogEntry,
    artifacts: readonly StagedContentModuleArtifact[],
  ): Promise<ContentModuleActivationReceipt> {
    this.activated = true;
    return {
      moduleId: module.id,
      version: module.version,
      installedSizeBytes: artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0),
      token: 'activation',
    };
  }

  public async restore(): Promise<void> {
    this.restored = true;
  }

  public async discardStaging(): Promise<void> {
    this.discarded = true;
  }
}

function validator(valid = true): ContentModuleIndexValidator {
  return {
    async validate() {
      return {
        checkedAt: '2026-07-21T00:00:00Z',
        valid,
        checksumValid: true,
        schemaCompatible: true,
        sqliteIntegrity: valid ? 'ok' : 'failed',
        message: valid ? 'ok' : 'bad sqlite',
      };
    },
  };
}

const runtime = {
  appVersion: '0.3.1',
  schemaVersion: 2,
  coreCatalogVersion: '1',
} as const;

describe('ForegroundContentModuleInstaller', () => {
  it('returns immediately, reports progress and activates only after validation', async () => {
    const indexBytes = new Uint8Array([1, 2, 3]);
    const sourceBytes = new Uint8Array([4, 5]);
    const { catalog, module } = await moduleFixture({ indexBytes, sourceBytes });
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    const downloader = new TestDownloader({ index: indexBytes, sources: sourceBytes });
    const backend = new TestBackend();
    const states: string[] = [];
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      downloader,
      backend,
      validator(),
      registry,
    );
    installer.subscribe((task) => states.push(task.state));

    const started = installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: true,
    });
    const completed = await installer.wait(started.id);

    expect(started.state).toBe('queued');
    expect(completed.state).toBe('completed');
    expect(completed.downloadedBytes).toBe(5);
    expect(downloader.calls).toEqual(['index', 'sources']);
    expect(backend.staged).toEqual(['index', 'sources']);
    expect(backend.activated).toBe(true);
    expect(registry.get(module.id)?.activeSourceSetDigest).toBe(sourceSetDigest);
    expect(states).toContain('verifying');
    expect(states).toContain('installing');
  });

  it('does not download optional source assets unless requested', async () => {
    const indexBytes = new Uint8Array([1]);
    const sourceBytes = new Uint8Array([2]);
    const { catalog, module } = await moduleFixture({ indexBytes, sourceBytes });
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    const downloader = new TestDownloader({ index: indexBytes, sources: sourceBytes });
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      downloader,
      new TestBackend(),
      validator(),
      registry,
    );

    const task = installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: false,
    });
    expect((await installer.wait(task.id)).state).toBe('completed');
    expect(downloader.calls).toEqual(['index']);
  });

  it('fails closed on checksum mismatch and preserves registry state', async () => {
    const indexBytes = new Uint8Array([1, 2, 3]);
    const { catalog, module } = await moduleFixture({ indexBytes });
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    const backend = new TestBackend();
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      new TestDownloader({ index: new Uint8Array([9, 9, 9]) }),
      backend,
      validator(),
      registry,
    );

    const task = installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: false,
    });
    const result = await installer.wait(task.id);

    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('checksum mismatch');
    expect(registry.get(module.id)).toBeNull();
    expect(backend.activated).toBe(false);
    expect(backend.discarded).toBe(true);
  });

  it('does not activate an index that fails SQLite validation', async () => {
    const indexBytes = new Uint8Array([1]);
    const { catalog, module } = await moduleFixture({ indexBytes });
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    const backend = new TestBackend();
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      new TestDownloader({ index: indexBytes }),
      backend,
      validator(false),
      registry,
    );

    const task = installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: false,
    });
    const result = await installer.wait(task.id);

    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('bad sqlite');
    expect(backend.activated).toBe(false);
    expect(registry.get(module.id)).toBeNull();
  });

  it('restores the previous file pointer if registry activation fails', async () => {
    const indexBytes = new Uint8Array([1]);
    const { catalog, module } = await moduleFixture({ indexBytes });
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    registry.activate(validatedInstallation(module.id));
    const backend = new TestBackend();
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      new TestDownloader({ index: indexBytes }),
      backend,
      validator(),
      registry,
    );

    const task = installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: false,
    });
    const result = await installer.wait(task.id);

    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('Required flag changed');
    expect(backend.activated).toBe(true);
    expect(backend.restored).toBe(true);
  });

  it('rejects missing required dependencies before creating a task', async () => {
    const indexBytes = new Uint8Array([1]);
    const { catalog, module } = await moduleFixture({ indexBytes });
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      new TestDownloader({ index: indexBytes }),
      new TestBackend(),
      validator(),
      new InMemoryInstalledModuleRegistry(),
    );

    expect(() =>
      installer.install({
        moduleId: module.id,
        version: module.version,
        includeSourceAssets: false,
      }),
    ).toThrow('Required module dependency is not enabled');
    expect(installer.listTasks()).toEqual([]);
  });

  it('returns the existing active task for duplicate install requests', async () => {
    const indexBytes = new Uint8Array([1]);
    const { catalog, module } = await moduleFixture({ indexBytes });
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    let releaseDownload: (() => void) | undefined;
    const downloader: ContentModuleArtifactDownloader = {
      async download(artifact, _signal, onProgress) {
        await new Promise<void>((resolve) => {
          releaseDownload = resolve;
        });
        onProgress({ downloadedBytes: indexBytes.byteLength, totalBytes: indexBytes.byteLength });
        return artifact.id === 'index' ? indexBytes : new Uint8Array();
      },
    };
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      downloader,
      new TestBackend(),
      validator(),
      registry,
    );

    const first = installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: false,
    });
    const second = installer.install({
      moduleId: module.id,
      version: module.version,
      includeSourceAssets: false,
    });

    expect(second.id).toBe(first.id);
    releaseDownload?.();
    expect((await installer.wait(first.id)).state).toBe('completed');
  });
});
