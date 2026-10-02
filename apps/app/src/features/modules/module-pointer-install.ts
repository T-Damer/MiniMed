import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ContentModuleDownloadTask,
  CoreIdentityHit,
  InstalledContentModule,
  MedicalDocumentSummary,
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
  source?: {
    readonly pointer: {
      readonly versionId: string;
      readonly sections: readonly {
        readonly anchor: string;
        readonly chunks: readonly { readonly anchor: string }[];
      }[];
    };
    readonly target: Pick<MedicalDocumentSummary, 'id' | 'versionId' | 'sourceChecksum'>;
  },
): string | null {
  if (!anchor) return null;
  const mentions = metadata?.['terminologyMentionAnchors'];
  if (mentions && typeof mentions === 'object' && Object.hasOwn(mentions, anchor)) {
    const target = (mentions as Readonly<Record<string, unknown>>)[anchor];
    if (typeof target === 'string' && target.length > 0) return target;
  }
  // Discovery definitions are readable locally, but their anchors are not detail-pack anchors.
  if (metadata?.['pointerKind'] === 'terminology') return null;
  if (metadata?.['definitionPreviewAnchor'] === anchor) {
    const definition = metadata['canonicalDefinition'];
    if (
      definition &&
      typeof definition === 'object' &&
      'sourceAnchor' in definition &&
      typeof definition.sourceAnchor === 'string'
    )
      return definition.sourceAnchor;
  }
  // Classification discovery sections are synthesized locally, not source paragraphs.
  // Open the proven original from its beginning rather than inventing a source anchor.
  if (
    source &&
    metadata?.['contentMode'] === 'module-pointer' &&
    metadata['targetDocumentId'] === source.target.id &&
    metadata['sourceDocumentId'] === source.target.id &&
    metadata['sourceDocumentVersionId'] === source.target.versionId &&
    metadata['sourceChecksum'] === source.target.sourceChecksum &&
    anchor.startsWith(`${source.pointer.versionId}/`) &&
    source.pointer.sections.some(
      (section) =>
        section.anchor === anchor || section.chunks.some((chunk) => chunk.anchor === anchor),
    )
  )
    return null;
  return anchor;
}

type ModuleDocument = ContentModuleCatalogEntry['documents'][number];

// Medication and reference modules list thousands of documents, and a home catalog asks about
// every one of ~20 000 pointers: a per-module index replaces a scan of the whole list per pointer.
const moduleDocumentIndexes = new WeakMap<
  ContentModuleCatalogEntry,
  ReadonlyMap<string, readonly ModuleDocument[]>
>();

function moduleDocumentsWithId(
  module: ContentModuleCatalogEntry,
  documentId: string,
): readonly ModuleDocument[] {
  let index = moduleDocumentIndexes.get(module);
  if (!index) {
    const built = new Map<string, ModuleDocument[]>();
    for (const document of module.documents) {
      const entries = built.get(document.documentId);
      if (entries) entries.push(document);
      else built.set(document.documentId, [document]);
    }
    index = built;
    moduleDocumentIndexes.set(module, index);
  }
  return index.get(documentId) ?? [];
}

function moduleContainsTarget(
  module: ContentModuleCatalogEntry,
  targetDocumentId: string,
  expectedIdentity?: Extract<CoreIdentityHit['target'], { readonly type: 'document' }>,
): boolean {
  return moduleDocumentsWithId(module, targetDocumentId).some(
    (document) =>
      (!expectedIdentity ||
        (document.documentVersionId === expectedIdentity.documentVersionId &&
          document.sourceChecksum === expectedIdentity.sourceChecksum)) &&
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
  const available = (module: ContentModuleCatalogEntry): boolean =>
    moduleContainsTarget(module, pointer.targetDocumentId) &&
    (isModuleReleased(module) || Boolean(installedModuleVersion(module, installed)));
  const declared = catalog.modules.filter(
    (module) => allowedIds.has(module.id) && available(module),
  );
  // A core built before its target set was published names a module id that never shipped. Exact
  // membership in a verified index is what makes a download safe, so any module that lists the
  // target document may serve it.
  const targetCandidates = declared.length ? declared : catalog.modules.filter(available);
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

/** Exact source identity must belong to the declared release and its verified index. */
export function catalogContainsIdentityDocumentTarget(
  target: Extract<CoreIdentityHit['target'], { readonly type: 'document' }>,
  catalog: ContentModuleCatalog,
  installed: readonly InstalledContentModule[] = [],
): boolean {
  return catalog.modules.some(
    (module) =>
      module.id === target.moduleId &&
      module.version === target.moduleVersion &&
      (isModuleReleased(module) || Boolean(installedModuleVersion(module, installed))) &&
      moduleContainsTarget(module, target.documentId, target),
  );
}

export function assertIdentityDocumentTarget(
  document: Pick<MedicalDocumentSummary, 'id' | 'versionId' | 'sourceChecksum'>,
  target: Extract<CoreIdentityHit['target'], { readonly type: 'document' }> | undefined,
): void {
  if (
    target &&
    (document.id !== target.documentId ||
      document.versionId !== target.documentVersionId ||
      document.sourceChecksum !== target.sourceChecksum)
  ) {
    throw new Error('Установленный документ другой редакции. Обновите набор в базе знаний.');
  }
}

/** Direct source links can name a detail document that has no discovery pointer. */
export function resolveCatalogDocumentPointer(
  documentId: string,
  catalog: ContentModuleCatalog,
  installed: readonly InstalledContentModule[],
  expectedIdentity?: Extract<CoreIdentityHit['target'], { readonly type: 'document' }>,
): ModulePointerResolution | null {
  if (
    expectedIdentity &&
    (expectedIdentity.documentId !== documentId ||
      !catalogContainsIdentityDocumentTarget(expectedIdentity, catalog, installed))
  )
    return null;
  const modules = catalog.modules.filter(
    (module) =>
      (!expectedIdentity ||
        (module.id === expectedIdentity.moduleId &&
          module.version === expectedIdentity.moduleVersion)) &&
      moduleDocumentsWithId(module, documentId).length > 0,
  );
  const primary = modules[0];
  if (!primary) return null;
  return resolveModulePointer(
    {
      contentMode: 'module-pointer',
      targetDocumentId: documentId,
      primaryModuleId: primary.id,
      moduleIds: modules.map((module) => module.id),
    },
    expectedIdentity ? { ...catalog, modules } : catalog,
    installed,
  );
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
