import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  InstalledContentModule,
} from '@localmed/contracts';

import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { contentModuleTaskProgress } from '@/features/modules/module-display';

export interface ModulePointerDescriptor {
  readonly contentMode: 'module-pointer';
  readonly targetDocumentId: string;
  readonly primaryModuleId: string;
  readonly moduleIds: readonly string[];
}

interface ModulePointerMetadata extends Readonly<Record<string, unknown>> {
  readonly contentMode?: unknown;
  readonly targetDocumentId?: unknown;
  readonly primaryModuleId?: unknown;
  readonly moduleIds?: unknown;
}

export type ModulePointerResolution =
  | {
      readonly state: 'available';
      readonly pointer: ModulePointerDescriptor;
      readonly module: ContentModuleCatalogEntry;
      readonly message: null;
    }
  | {
      readonly state: 'installed';
      readonly pointer: ModulePointerDescriptor;
      readonly module: ContentModuleCatalogEntry;
      readonly message: null;
    }
  | {
      readonly state: 'unavailable';
      readonly pointer: ModulePointerDescriptor;
      readonly module: null;
      readonly message: string;
    };

export interface ModulePointerRuntime {
  readonly install: (module: ContentModuleCatalogEntry) => ContentModuleDownloadTask;
  readonly wait: (taskId: string) => Promise<ContentModuleDownloadTask>;
  readonly subscribe: (listener: (task: ContentModuleDownloadTask) => void) => () => void;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value.flatMap((item) => {
    const normalized = stringValue(item);
    return normalized ? [normalized] : [];
  });
  return values.length > 0 ? values : null;
}

export function parseModulePointerMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ModulePointerDescriptor | null {
  const pointerMetadata = metadata as ModulePointerMetadata | undefined;
  if (pointerMetadata?.contentMode !== 'module-pointer') return null;
  const targetDocumentId = stringValue(pointerMetadata.targetDocumentId);
  const primaryModuleId = stringValue(pointerMetadata.primaryModuleId);
  const moduleIds = stringList(pointerMetadata.moduleIds);
  if (!targetDocumentId || !primaryModuleId || !moduleIds) return null;
  return {
    contentMode: 'module-pointer',
    targetDocumentId,
    primaryModuleId,
    moduleIds: [...new Set([primaryModuleId, ...moduleIds])],
  };
}

/** Discovery excerpts have local anchors; full documents use the original source anchor. */
export function modulePointerTargetAnchor(
  metadata: Readonly<Record<string, unknown>> | undefined,
  anchor: string | null,
): string | null {
  if (!anchor || metadata?.['definitionPreviewAnchor'] !== anchor) return anchor;
  const definition = metadata['canonicalDefinition'];
  if (!definition || typeof definition !== 'object' || !('sourceAnchor' in definition))
    return anchor;
  return typeof definition.sourceAnchor === 'string' ? definition.sourceAnchor : anchor;
}

function moduleContainsTarget(
  module: ContentModuleCatalogEntry,
  targetDocumentId: string,
): boolean {
  return module.documents.some(
    (document) =>
      document.documentId === targetDocumentId &&
      module.artifacts.some(
        (artifact) =>
          artifact.id === document.indexArtifactId &&
          artifact.kind === 'index' &&
          artifact.required &&
          Boolean(artifact.url && artifact.sha256),
      ),
  );
}

export function selectModuleForPointer(
  pointer: ModulePointerDescriptor,
  catalog: ContentModuleCatalog,
  installed: readonly InstalledContentModule[] = [],
): ContentModuleCatalogEntry | null {
  const allowedIds = new Set([pointer.primaryModuleId, ...pointer.moduleIds]);
  const candidates = catalog.modules.filter((module) => allowedIds.has(module.id));
  const targetCandidates = candidates.filter(
    (module) =>
      moduleContainsTarget(module, pointer.targetDocumentId) &&
      (isModuleReleased(module) || Boolean(installedModuleVersion(module, installed))),
  );
  return (
    targetCandidates.find((module) => installedModuleVersion(module, installed)) ??
    targetCandidates.find((module) => module.id === pointer.primaryModuleId) ??
    targetCandidates[0] ??
    null
  );
}

function installedModuleVersion(
  module: ContentModuleCatalogEntry,
  installed: readonly InstalledContentModule[],
): InstalledContentModule | null {
  return (
    installed.find(
      (candidate) =>
        candidate.moduleId === module.id &&
        candidate.version === module.version &&
        candidate.activeSourceSetDigest === module.sourceSetDigest &&
        candidate.enabled &&
        candidate.state === 'installed',
    ) ?? null
  );
}

export function resolveModulePointer(
  pointer: ModulePointerDescriptor,
  catalog: ContentModuleCatalog,
  installed: readonly InstalledContentModule[],
): ModulePointerResolution {
  const module = selectModuleForPointer(pointer, catalog, installed);
  if (!module) {
    return {
      state: 'unavailable',
      pointer,
      module: null,
      message: 'Набор с полным документом не найден в каталоге загрузок.',
    };
  }
  if (installedModuleVersion(module, installed)) {
    return { state: 'installed', pointer, module, message: null };
  }
  return { state: 'available', pointer, module, message: null };
}

export async function installModulePointer(
  runtime: ModulePointerRuntime,
  resolution: ModulePointerResolution,
  onProgress?: (fraction: number | null) => void,
): Promise<ContentModuleDownloadTask> {
  if (resolution.state === 'unavailable' || !resolution.module) {
    throw new Error(resolution.message);
  }
  if (resolution.state === 'installed') {
    return {
      id: `${resolution.module.id}@${resolution.module.version}`,
      moduleId: resolution.module.id,
      version: resolution.module.version,
      state: 'completed',
      downloadedBytes: resolution.module.sizes.downloadBytes ?? 0,
      totalBytes: resolution.module.sizes.downloadBytes,
      includeSourceAssets: false,
      runsInBackground: false,
      errorMessage: null,
    };
  }

  const task = runtime.install(resolution.module);
  onProgress?.(contentModuleTaskProgress(task));
  const unsubscribe = runtime.subscribe((nextTask) => {
    if (nextTask.id === task.id) onProgress?.(contentModuleTaskProgress(nextTask));
  });
  let completed: ContentModuleDownloadTask;
  try {
    completed = await runtime.wait(task.id);
  } finally {
    unsubscribe();
  }
  onProgress?.(contentModuleTaskProgress(completed));
  if (completed.state !== 'completed') {
    throw new Error(completed.errorMessage ?? 'Не удалось загрузить набор документа.');
  }
  return completed;
}
