import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import {
  type ContentModuleActivationReceipt,
  type ContentModuleArtifactBackend,
  type ContentModuleArtifactDownloader,
  type ContentModuleIndexValidator,
  ForegroundContentModuleInstaller,
  type StagedContentModuleArtifact,
} from '@localmed/core';
import { InMemoryInstalledModuleRegistry, type ModuleVersionInstallation } from '@localmed/storage';
import { describe, expect, it, vi } from 'vitest';

type Artifact = ContentModuleCatalogEntry['artifacts'][number];

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

class BlockingDownloader implements ContentModuleArtifactDownloader {
  public active = 0;
  public maxActive = 0;
  public calls = 0;
  private readonly releases: Array<() => void> = [];

  public constructor(private readonly bytes: Uint8Array) {}

  public download(
    _artifact: Artifact,
    _signal: AbortSignal,
    onProgress: (progress: { downloadedBytes: number; totalBytes: number | null }) => void,
  ): Promise<Uint8Array> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise((resolve) => {
      this.releases.push(() => {
        this.active -= 1;
        onProgress({ downloadedBytes: this.bytes.byteLength, totalBytes: this.bytes.byteLength });
        resolve(this.bytes);
      });
    });
  }

  public releaseOne(): void {
    this.releases.shift()?.();
  }

  public releaseAll(): void {
    for (const release of this.releases.splice(0)) release();
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
  it('checks transport and decoded identities before staging a compressed index', async () => {
    const archive = new Uint8Array([1, 2, 3]);
    const decoded = new Uint8Array([4, 5, 6, 7]);
    for (const failure of [null, 'archive', 'decoded'] as const) {
      const { catalog, module } = await moduleFixture({ indexBytes: archive });
      const index = module.artifacts[0];
      if (!index) throw new Error('Fixture has no index.');
      Object.assign(index, {
        compression: 'gzip',
        decodedSizeBytes: decoded.length,
        decodedSha256: failure === 'decoded' ? sourceSetDigest : await checksum(decoded),
      });
      const registry = new InMemoryInstalledModuleRegistry();
      registry.activate(validatedInstallation());
      registry.activate({ ...validatedInstallation(module.id), version: '0.9.0' });
      const backend = new TestBackend();
      const stage = vi.spyOn(backend, 'stage');
      const decode = vi.fn(async () => decoded);
      const check = validator();
      const validate = vi.spyOn(check, 'validate');
      const installer = new ForegroundContentModuleInstaller(
        catalog,
        runtime,
        new TestDownloader({ index: failure === 'archive' ? new Uint8Array([9, 9, 9]) : archive }),
        backend,
        check,
        registry,
        1,
        decode,
      );
      const task = installer.install({
        moduleId: module.id,
        version: module.version,
        includeSourceAssets: false,
      });
      await installer.wait(task.id);
      if (failure) {
        expect(backend.activated).toBe(false);
        expect(registry.get(module.id)?.version).toBe('0.9.0');
        expect(stage).not.toHaveBeenCalled();
        if (failure === 'archive') expect(decode).not.toHaveBeenCalled();
      } else {
        expect(stage).toHaveBeenCalledWith(expect.anything(), expect.anything(), decoded);
        expect(validate).toHaveBeenCalledWith(expect.anything(), decoded);
        expect(registry.get(module.id)?.installedSizeBytes).toBe(decoded.length);
        expect(installer.listTasks().find((item) => item.id === task.id)?.downloadedBytes).toBe(
          archive.length,
        );
      }
    }
  });

  it('rejects an unbuilt preview before adding a task or starting a download', async () => {
    const fixture = await moduleFixture({ indexBytes: new Uint8Array([1]) });
    const unbuilt = { ...fixture.module, releaseState: 'preview' as const, artifacts: [] };
    const catalog = {
      ...fixture.catalog,
      modules: [fixture.catalog.modules[0] as ContentModuleCatalogEntry, unbuilt],
    };
    const downloader = new TestDownloader({});
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      downloader,
      new TestBackend(),
      validator(),
      registry,
    );
    expect(() =>
      installer.install({
        moduleId: unbuilt.id,
        version: unbuilt.version,
        includeSourceAssets: false,
      }),
    ).toThrow('no downloadable verified index');
    expect(installer.listTasks()).toEqual([]);
    expect(downloader.calls).toEqual([]);
  });

  it('keeps installs above the concurrency limit queued', async () => {
    const indexBytes = new Uint8Array([1, 2, 3]);
    const fixture = await moduleFixture({ indexBytes });
    const modules = Array.from({ length: 4 }, (_, index) => ({
      ...fixture.module,
      id: `minimed.clinical.test-${index + 1}`,
      title: `Test ${index + 1}`,
    }));
    const catalog = {
      ...fixture.catalog,
      modules: [fixture.catalog.modules[0] as ContentModuleCatalogEntry, ...modules],
    };
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    const downloader = new BlockingDownloader(indexBytes);
    const installer = new ForegroundContentModuleInstaller(
      catalog,
      runtime,
      downloader,
      new TestBackend(),
      validator(),
      registry,
      3,
    );

    const tasks = modules.map((module) =>
      installer.install({
        moduleId: module.id,
        version: module.version,
        includeSourceAssets: false,
      }),
    );
    await vi.waitFor(() => expect(downloader.active).toBe(3));
    expect(installer.listTasks().find((task) => task.id === tasks[3]?.id)?.state).toBe('queued');

    downloader.releaseOne();
    await vi.waitFor(() => expect(downloader.calls).toBe(4));
    downloader.releaseAll();
    await Promise.all(tasks.map((task) => installer.wait(task.id)));
    expect(downloader.maxActive).toBe(3);
  });

  it('keeps active downloads while the catalog is updated', async () => {
    const indexBytes = new Uint8Array([1, 2, 3]);
    const fixture = await moduleFixture({ indexBytes });
    const nextModule = {
      ...fixture.module,
      id: 'minimed.clinical.pediatrics.updated-catalog',
      title: 'Added after refresh',
    };
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(validatedInstallation());
    const downloader = new BlockingDownloader(indexBytes);
    const installer = new ForegroundContentModuleInstaller(
      fixture.catalog,
      runtime,
      downloader,
      new TestBackend(),
      validator(),
      registry,
      1,
    );

    const first = installer.install({
      moduleId: fixture.module.id,
      version: fixture.module.version,
      includeSourceAssets: false,
    });
    await vi.waitFor(() => expect(downloader.active).toBe(1));
    installer.updateCatalog({
      ...fixture.catalog,
      catalogVersion: '2',
      modules: [...fixture.catalog.modules, nextModule],
    });
    const second = installer.install({
      moduleId: nextModule.id,
      version: nextModule.version,
      includeSourceAssets: false,
    });
    expect(installer.listTasks().find((task) => task.id === first.id)?.state).toBe('downloading');
    expect(installer.listTasks().find((task) => task.id === second.id)?.state).toBe('queued');

    downloader.releaseOne();
    await vi.waitFor(() => expect(downloader.calls).toBe(2));
    downloader.releaseOne();
    await expect(installer.wait(first.id)).resolves.toMatchObject({ state: 'completed' });
    await expect(installer.wait(second.id)).resolves.toMatchObject({ state: 'completed' });
  });

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
    registry.activate({ ...validatedInstallation(module.id), required: true });
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
    await vi.waitFor(() => expect(releaseDownload).toBeTypeOf('function'));
    releaseDownload?.();
    expect((await installer.wait(first.id)).state).toBe('completed');
  });
});

function lifecycleGate() {
  let release: () => void = () => {
    throw new Error('gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function lifecycleFixture() {
  const bytes = new Uint8Array([11, 12, 13]);
  const original = await moduleFixture({ indexBytes: bytes });
  const module = { ...original.module, version: '1.1.0' };
  const core = original.catalog.modules.find((entry) => entry.kind === 'core');
  if (!core) throw new Error('Fixture core is missing.');
  const catalog = { ...original.catalog, modules: [core, module] };
  const registry = new InMemoryInstalledModuleRegistry();
  registry.activate(validatedInstallation());
  registry.activate(validatedInstallation(module.id));
  const before = registry.snapshot();
  const backend = new TestBackend();
  const indexValidator = validator();
  const installer = new ForegroundContentModuleInstaller(
    catalog,
    runtime,
    new TestDownloader({ index: bytes }),
    backend,
    indexValidator,
    registry,
    1,
  );
  const start = () =>
    installer.install({ moduleId: module.id, version: module.version, includeSourceAssets: false });
  return { bytes, module, catalog, registry, before, backend, indexValidator, installer, start };
}

describe('module payload lifecycle regressions', () => {
  it('late cancellation after SQLite validation cannot activate or replace the working edition', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate();
    const resume = lifecycleGate();
    const validate = f.indexValidator.validate.bind(f.indexValidator);
    vi.spyOn(f.indexValidator, 'validate').mockImplementation(async (...args) => {
      entered.release();
      await resume.promise;
      return validate(...args);
    });
    const task = f.start();
    await entered.promise;
    f.installer.cancel(task.id);
    resume.release();
    expect((await f.installer.wait(task.id)).state).toBe('cancelled');
    expect(f.backend.activated).toBe(false);
    expect(f.backend.discarded).toBe(true);
    expect(f.registry.snapshot()).toEqual(f.before);
  });

  it('late cancellation during activation restores the previous pointer before completing', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate();
    const resume = lifecycleGate();
    const activate = f.backend.activate.bind(f.backend);
    vi.spyOn(f.backend, 'activate').mockImplementation(async (...args) => {
      const receipt = await activate(...args);
      entered.release();
      await resume.promise;
      return receipt;
    });
    const task = f.start();
    await entered.promise;
    f.installer.cancel(task.id);
    resume.release();
    expect((await f.installer.wait(task.id)).state).toBe('cancelled');
    expect(f.backend.restored).toBe(true);
    expect(f.registry.snapshot()).toEqual(f.before);
  });

  it('a cancelled staging operation must finish draining before the same module retries', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate();
    const resume = lifecycleGate();
    const stage = f.backend.stage.bind(f.backend);
    vi.spyOn(f.backend, 'stage').mockImplementationOnce(async (...args) => {
      entered.release();
      await resume.promise;
      return stage(...args);
    });
    const task = f.start();
    await entered.promise;
    f.installer.cancel(task.id);
    expect(() => f.start()).toThrow(/settling/u);
    resume.release();
    expect((await f.installer.wait(task.id)).state).toBe('cancelled');
    expect(f.backend.activated).toBe(false);
    const retry = f.start();
    expect((await f.installer.wait(retry.id)).state).toBe('completed');
    expect(f.registry.get(f.module.id)?.version).toBe('1.1.0');
  });

  it('different editions of one module cannot race their activation receipts', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate();
    const resume = lifecycleGate();
    const validate = f.indexValidator.validate.bind(f.indexValidator);
    vi.spyOn(f.indexValidator, 'validate').mockImplementation(async (...args) => {
      entered.release();
      await resume.promise;
      return validate(...args);
    });
    const task = f.start();
    await entered.promise;
    const newer = { ...f.module, version: '1.2.0' };
    f.installer.updateCatalog({
      ...f.catalog,
      modules: f.catalog.modules.map((entry) => (entry.id === newer.id ? newer : entry)),
    });
    expect(() =>
      f.installer.install({
        moduleId: newer.id,
        version: newer.version,
        includeSourceAssets: false,
      }),
    ).toThrow(/in progress/u);
    resume.release();
    await f.installer.wait(task.id);
  });

  it('cancellation recovery errors are failures, not successful cancellation', async () => {
    const f = await lifecycleFixture();
    const entered = lifecycleGate();
    const resume = lifecycleGate();
    const activate = f.backend.activate.bind(f.backend);
    vi.spyOn(f.backend, 'activate').mockImplementation(async (...args) => {
      const receipt = await activate(...args);
      entered.release();
      await resume.promise;
      return receipt;
    });
    vi.spyOn(f.backend, 'restore').mockRejectedValue(new Error('storage unavailable'));
    const task = f.start();
    await entered.promise;
    f.installer.cancel(task.id);
    resume.release();
    const result = await f.installer.wait(task.id);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('restore');
    expect(f.registry.snapshot()).toEqual(f.before);
  });

  it('staging cleanup failure remains observable even when cancellation was requested', async () => {
    const f = await lifecycleFixture();
    vi.spyOn(f.backend, 'discardStaging').mockRejectedValue(new Error('cleanup unavailable'));
    const entered = lifecycleGate();
    const resume = lifecycleGate();
    const validate = f.indexValidator.validate.bind(f.indexValidator);
    vi.spyOn(f.indexValidator, 'validate').mockImplementation(async (...args) => {
      entered.release();
      await resume.promise;
      return validate(...args);
    });
    const task = f.start();
    await entered.promise;
    f.installer.cancel(task.id);
    resume.release();
    const result = await f.installer.wait(task.id);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toContain('cleanup');
    expect(f.backend.activated).toBe(false);
  });

  it('a corrupted archive leaves the previous installed edition unchanged', async () => {
    const f = await lifecycleFixture();
    const corrupted = new ForegroundContentModuleInstaller(
      f.catalog,
      runtime,
      new TestDownloader({ index: new Uint8Array([0, 0, 0]) }),
      f.backend,
      f.indexValidator,
      f.registry,
      1,
    );
    const task = corrupted.install({
      moduleId: f.module.id,
      version: f.module.version,
      includeSourceAssets: false,
    });
    expect((await corrupted.wait(task.id)).state).toBe('failed');
    expect(f.backend.staged).toHaveLength(0);
    expect(f.registry.snapshot()).toEqual(f.before);
  });

  it('an invalid SQLite edition leaves the previous installed edition unchanged', async () => {
    const f = await lifecycleFixture();
    vi.spyOn(f.indexValidator, 'validate').mockImplementation(validator(false).validate);
    expect((await f.installer.wait(f.start().id)).state).toBe('failed');
    expect(f.backend.activated).toBe(false);
    expect(f.registry.snapshot()).toEqual(f.before);
  });
});
