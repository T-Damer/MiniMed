import {
  type ContentModuleArtifactSchema,
  type ContentModuleCatalog,
  type ContentModuleCatalogEntry,
  ContentModuleCatalogSchema,
  type ContentModuleDownloadTask,
  type ContentModuleValidationSchema,
  type InstallContentModuleRequest,
} from '@localmed/contracts';
import type { InstalledModuleRegistry, ModuleVersionInstallation } from '@localmed/storage';
import type { z } from 'zod';

type ModuleArtifact = z.infer<typeof ContentModuleArtifactSchema>;
type ModuleValidation = z.infer<typeof ContentModuleValidationSchema>;

export interface ContentModuleRuntimeCompatibility {
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly coreCatalogVersion: string;
}

export interface ContentModuleDownloadProgress {
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
}

export interface ContentModuleArtifactDownloader {
  download(
    artifact: ModuleArtifact,
    signal: AbortSignal,
    onProgress: (progress: ContentModuleDownloadProgress) => void,
  ): Promise<Uint8Array>;
}

export interface StagedContentModuleArtifact {
  readonly artifactId: string;
  readonly kind: ModuleArtifact['kind'];
  readonly sizeBytes: number;
  readonly token: string;
}

export interface ContentModuleActivationReceipt {
  readonly moduleId: string;
  readonly version: string;
  readonly installedSizeBytes: number;
  readonly token: string;
}

export interface ContentModuleArtifactBackend {
  stage(
    module: ContentModuleCatalogEntry,
    artifact: ModuleArtifact,
    bytes: Uint8Array,
  ): Promise<StagedContentModuleArtifact>;
  activate(
    module: ContentModuleCatalogEntry,
    artifacts: readonly StagedContentModuleArtifact[],
  ): Promise<ContentModuleActivationReceipt>;
  restore(receipt: ContentModuleActivationReceipt): Promise<void>;
  discardStaging(moduleId: string, version: string): Promise<void>;
}

export interface ContentModuleIndexValidator {
  validate(module: ContentModuleCatalogEntry, indexBytes: Uint8Array): Promise<ModuleValidation>;
}

export type ContentModuleTaskListener = (task: ContentModuleDownloadTask) => void;

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseVersion(value: string): ParsedVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value);
  if (!match) throw new Error(`Unsupported semantic version: ${value}.`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersion(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function satisfiesRange(version: string, range: string): boolean {
  if (range.startsWith('^')) {
    const base = range.slice(1);
    return (
      parseVersion(version).major === parseVersion(base).major && compareVersion(version, base) >= 0
    );
  }
  return version === range;
}

function assertRuntimeCompatible(
  module: ContentModuleCatalogEntry,
  runtime: ContentModuleRuntimeCompatibility,
): void {
  const compatibility = module.compatibility;
  if (compareVersion(runtime.appVersion, compatibility.minAppVersion) < 0) {
    throw new Error(
      `Module ${module.id} requires MiniMed ${compatibility.minAppVersion} or newer.`,
    );
  }
  if (
    compatibility.maxAppVersion &&
    compareVersion(runtime.appVersion, compatibility.maxAppVersion) > 0
  ) {
    throw new Error(`Module ${module.id} is not compatible with MiniMed ${runtime.appVersion}.`);
  }
  if (runtime.schemaVersion !== compatibility.schemaVersion) {
    throw new Error(
      `Module ${module.id} requires schema ${compatibility.schemaVersion}, current ${runtime.schemaVersion}.`,
    );
  }
  if (runtime.coreCatalogVersion !== compatibility.coreCatalogVersion) {
    throw new Error(
      `Module ${module.id} requires core catalog ${compatibility.coreCatalogVersion}.`,
    );
  }
}

function assertDependencies(
  module: ContentModuleCatalogEntry,
  registry: InstalledModuleRegistry,
): void {
  for (const dependency of module.dependencies) {
    if (!dependency.required) continue;
    const installed = registry.get(dependency.moduleId);
    if (!installed || !installed.enabled) {
      throw new Error(`Required module dependency is not enabled: ${dependency.moduleId}.`);
    }
    if (!satisfiesRange(installed.version, dependency.versionRange)) {
      throw new Error(
        `Module ${module.id} requires ${dependency.moduleId} ${dependency.versionRange}; installed ${installed.version}.`,
      );
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function totalBytes(artifacts: readonly ModuleArtifact[]): number | null {
  return artifacts.every((artifact): artifact is ModuleArtifact & { sizeBytes: number } =>
    Number.isSafeInteger(artifact.sizeBytes),
  )
    ? artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0)
    : null;
}

function taskId(moduleId: string, version: string): string {
  return `${moduleId}@${version}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export class ForegroundContentModuleInstaller {
  private readonly catalog: ContentModuleCatalog;
  private readonly tasks = new Map<string, ContentModuleDownloadTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly completions = new Map<string, Promise<ContentModuleDownloadTask>>();
  private readonly listeners = new Set<ContentModuleTaskListener>();

  public constructor(
    catalog: ContentModuleCatalog,
    private readonly runtime: ContentModuleRuntimeCompatibility,
    private readonly downloader: ContentModuleArtifactDownloader,
    private readonly backend: ContentModuleArtifactBackend,
    private readonly validator: ContentModuleIndexValidator,
    private readonly registry: InstalledModuleRegistry,
  ) {
    this.catalog = ContentModuleCatalogSchema.parse(catalog);
  }

  public listTasks(): readonly ContentModuleDownloadTask[] {
    return [...this.tasks.values()].toSorted((left, right) => left.id.localeCompare(right.id));
  }

  public subscribe(listener: ContentModuleTaskListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public install(request: InstallContentModuleRequest): ContentModuleDownloadTask {
    const module = this.catalog.modules.find(
      (candidate) => candidate.id === request.moduleId && candidate.version === request.version,
    );
    if (!module) throw new Error(`Unknown module version: ${request.moduleId}@${request.version}.`);
    if (module.releaseState !== 'published') {
      throw new Error(`Module ${module.id}@${module.version} is not published.`);
    }
    if (!module.sourceSetDigest) throw new Error(`Module ${module.id} has no source-set digest.`);
    assertRuntimeCompatible(module, this.runtime);
    assertDependencies(module, this.registry);

    const artifacts = module.artifacts.filter(
      (artifact) => artifact.kind === 'index' || request.includeSourceAssets || artifact.required,
    );
    const indexArtifact = artifacts.find((artifact) => artifact.kind === 'index');
    if (!indexArtifact) throw new Error(`Module ${module.id} has no index artifact.`);

    const existingTask = [...this.tasks.values()].find(
      (task) =>
        task.moduleId === module.id &&
        task.version === module.version &&
        !['completed', 'failed', 'cancelled'].includes(task.state),
    );
    if (existingTask) return existingTask;

    const id = taskId(module.id, module.version);
    const task: ContentModuleDownloadTask = {
      id,
      moduleId: module.id,
      version: module.version,
      state: 'queued',
      downloadedBytes: 0,
      totalBytes: totalBytes(artifacts),
      includeSourceAssets: request.includeSourceAssets,
      runsInBackground: false,
      errorMessage: null,
    };
    const controller = new AbortController();
    this.tasks.set(id, task);
    this.controllers.set(id, controller);
    this.emit(task);
    const completion = this.run(task, module, artifacts, indexArtifact, controller.signal);
    this.completions.set(id, completion);
    return task;
  }

  public async wait(taskIdValue: string): Promise<ContentModuleDownloadTask> {
    const completion = this.completions.get(taskIdValue);
    if (!completion) {
      const existing = this.tasks.get(taskIdValue);
      if (existing) return existing;
      throw new Error(`Unknown content-module task: ${taskIdValue}.`);
    }
    return completion;
  }

  public cancel(taskIdValue: string): ContentModuleDownloadTask {
    const task = this.requireTask(taskIdValue);
    if (['completed', 'failed', 'cancelled'].includes(task.state)) return task;
    this.controllers.get(taskIdValue)?.abort();
    return this.setTask(taskIdValue, { state: 'cancelled', errorMessage: null });
  }

  private async run(
    task: ContentModuleDownloadTask,
    module: ContentModuleCatalogEntry,
    artifacts: readonly ModuleArtifact[],
    indexArtifact: ModuleArtifact,
    signal: AbortSignal,
  ): Promise<ContentModuleDownloadTask> {
    const staged: StagedContentModuleArtifact[] = [];
    const bytesByArtifact = new Map<string, Uint8Array>();
    const completedBytes = new Map<string, number>();
    try {
      this.setTask(task.id, { state: 'downloading' });
      for (const artifact of artifacts) {
        if (!artifact.url || !artifact.sha256) {
          throw new Error(`Artifact ${artifact.id} has no immutable URL/checksum.`);
        }
        const bytes = await this.downloader.download(artifact, signal, (progress) => {
          const previousArtifacts = [...completedBytes.values()].reduce(
            (total, value) => total + value,
            0,
          );
          this.setTask(task.id, {
            downloadedBytes: previousArtifacts + progress.downloadedBytes,
          });
        });
        if (signal.aborted) throw new DOMException('Installation cancelled.', 'AbortError');
        if (artifact.sizeBytes !== null && bytes.byteLength !== artifact.sizeBytes) {
          throw new Error(
            `Artifact ${artifact.id} size mismatch: ${bytes.byteLength} != ${artifact.sizeBytes}.`,
          );
        }
        const checksum = await sha256(bytes);
        if (checksum !== artifact.sha256) {
          throw new Error(`Artifact ${artifact.id} checksum mismatch.`);
        }
        bytesByArtifact.set(artifact.id, bytes);
        completedBytes.set(artifact.id, bytes.byteLength);
        staged.push(await this.backend.stage(module, artifact, bytes));
        this.setTask(task.id, {
          downloadedBytes: [...completedBytes.values()].reduce((total, value) => total + value, 0),
        });
      }

      this.setTask(task.id, { state: 'verifying' });
      const indexBytes = bytesByArtifact.get(indexArtifact.id);
      if (!indexBytes) throw new Error(`Index artifact ${indexArtifact.id} was not downloaded.`);
      const validation = await this.validator.validate(module, indexBytes);
      if (
        !validation.valid ||
        !validation.checksumValid ||
        !validation.schemaCompatible ||
        validation.sqliteIntegrity !== 'ok'
      ) {
        throw new Error(`Module index validation failed: ${validation.message}`);
      }

      this.setTask(task.id, { state: 'installing' });
      const receipt = await this.backend.activate(module, staged);
      try {
        const installation: ModuleVersionInstallation = {
          moduleId: module.id,
          version: module.version,
          required: module.required,
          installedAt: new Date().toISOString(),
          installedSizeBytes: receipt.installedSizeBytes,
          sourceSetDigest: module.sourceSetDigest,
          validation,
        };
        this.registry.activate(installation);
      } catch (cause) {
        await this.backend.restore(receipt);
        throw cause;
      }

      return this.setTask(task.id, {
        state: 'completed',
        downloadedBytes: task.totalBytes ?? [...completedBytes.values()].reduce((a, b) => a + b, 0),
        errorMessage: null,
      });
    } catch (cause) {
      await this.backend.discardStaging(module.id, module.version);
      if (signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
        return this.setTask(task.id, { state: 'cancelled', errorMessage: null });
      }
      return this.setTask(task.id, {
        state: 'failed',
        errorMessage: cause instanceof Error ? cause.message : 'Module installation failed.',
      });
    } finally {
      this.controllers.delete(task.id);
      this.completions.delete(task.id);
    }
  }

  private setTask(
    id: string,
    patch: Partial<ContentModuleDownloadTask>,
  ): ContentModuleDownloadTask {
    const current = this.requireTask(id);
    const next = { ...current, ...patch };
    this.tasks.set(id, next);
    this.emit(next);
    return next;
  }

  private requireTask(id: string): ContentModuleDownloadTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Unknown content-module task: ${id}.`);
    return task;
  }

  private emit(task: ContentModuleDownloadTask): void {
    for (const listener of this.listeners) listener(task);
  }
}
