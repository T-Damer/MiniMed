import { z } from 'zod';

import type { LocalMedError } from './errors';
import type { Result } from './result';

export const ContentModuleKindSchema = z.enum([
  'core',
  'clinical',
  'medication',
  'regulatory',
  'reference',
  'personal',
]);

export const ContentModuleReleaseStateSchema = z.enum([
  'bundled',
  'published',
  'preview',
  'planned',
]);

export const ContentModuleArtifactKindSchema = z.enum(['index', 'source-assets']);
export const ContentModuleCompressionSchema = z.enum(['none', 'zip', 'zstd']);
export const ContentModuleSizePrecisionSchema = z.enum(['exact', 'estimate', 'unknown']);

export const ContentModuleInstallStateSchema = z.enum([
  'not-installed',
  'queued',
  'downloading',
  'verifying',
  'installing',
  'installed',
  'update-available',
  'disabled',
  'failed',
]);

export const ContentModuleCapabilitiesSchema = z.object({
  search: z.boolean(),
  fullText: z.boolean(),
  structuredTables: z.boolean(),
  images: z.boolean(),
  originalPdf: z.boolean(),
  structuredKnowledge: z.boolean(),
  calculations: z.boolean(),
});

export const ContentModuleSizeSchema = z.object({
  downloadBytes: z.number().int().nonnegative().nullable().default(null),
  installedBytes: z.number().int().nonnegative().nullable().default(null),
  sourceAssetsDownloadBytes: z.number().int().nonnegative().nullable().default(null),
  precision: ContentModuleSizePrecisionSchema.default('unknown'),
});

export const ContentModuleCompatibilitySchema = z.object({
  minAppVersion: z.string().min(1),
  maxAppVersion: z.string().min(1).nullable().default(null),
  schemaVersion: z.number().int().positive(),
  coreCatalogVersion: z.string().min(1),
});

export const ContentModuleDependencySchema = z.object({
  moduleId: z.string().min(1),
  versionRange: z.string().min(1),
  required: z.boolean().default(true),
});

export const ContentModuleArtifactSchema = z.object({
  id: z.string().min(1),
  kind: ContentModuleArtifactKindSchema,
  required: z.boolean(),
  url: z.string().url().nullable().default(null),
  sha256: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .nullable()
    .default(null),
  sizeBytes: z.number().int().nonnegative().nullable().default(null),
  compression: ContentModuleCompressionSchema,
  sourceSetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

export const ContentModuleDocumentVersionSchema = z.object({
  documentId: z.string().min(1),
  documentVersionId: z.string().min(1),
  sourceChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  status: z.enum(['active', 'superseded', 'historical']),
  indexArtifactId: z.string().min(1),
  sourceAssetArtifactId: z.string().min(1).nullable().default(null),
});

export const CoreCatalogRelationStubSchema = z.object({
  predicate: z.string().min(1),
  targetId: z.string().min(1),
  weight: z.number().min(0).max(1),
});

export const CoreCatalogTopicStubSchema = z.object({
  id: z.string().min(1),
  entityType: z.enum(['disease', 'medication', 'regulation', 'reference']),
  title: z.string().min(1),
  summary: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  moduleIds: z.array(z.string().min(1)).min(1),
  relations: z.array(CoreCatalogRelationStubSchema).default([]),
});

export const ContentModuleCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    kind: ContentModuleKindSchema,
    collection: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    required: z.boolean(),
    releaseState: ContentModuleReleaseStateSchema,
    specialties: z.array(z.string().min(1)).default([]),
    populations: z.array(z.string().min(1)).default([]),
    tags: z.array(z.string().min(1)).default([]),
    compatibility: ContentModuleCompatibilitySchema,
    sourceSetDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable()
      .default(null),
    dependencies: z.array(ContentModuleDependencySchema).default([]),
    sizes: ContentModuleSizeSchema,
    capabilities: ContentModuleCapabilitiesSchema,
    artifacts: z.array(ContentModuleArtifactSchema).default([]),
    documents: z.array(ContentModuleDocumentVersionSchema).default([]),
    previewDocumentCount: z.number().int().nonnegative().default(0),
  })
  .superRefine((module, context) => {
    if (module.kind === 'core' && !module.required) {
      context.addIssue({
        code: 'custom',
        path: ['required'],
        message: 'Core modules must be required.',
      });
    }
    if (module.dependencies.some((dependency) => dependency.moduleId === module.id)) {
      context.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message: 'A module cannot depend on itself.',
      });
    }
    for (const artifact of module.artifacts) {
      if (!module.sourceSetDigest || artifact.sourceSetDigest !== module.sourceSetDigest) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts'],
          message: `Artifact ${artifact.id} does not match the module source set.`,
        });
      }
    }
    if (module.documents.length > 0 && !module.sourceSetDigest) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSetDigest'],
        message: 'Modules with documents require an exact source-set digest.',
      });
    }
    const artifactIds = new Set(module.artifacts.map((artifact) => artifact.id));
    for (const document of module.documents) {
      if (!artifactIds.has(document.indexArtifactId)) {
        context.addIssue({
          code: 'custom',
          path: ['documents'],
          message: `Document ${document.documentVersionId} references a missing index artifact.`,
        });
      }
      if (document.sourceAssetArtifactId && !artifactIds.has(document.sourceAssetArtifactId)) {
        context.addIssue({
          code: 'custom',
          path: ['documents'],
          message: `Document ${document.documentVersionId} references missing source assets.`,
        });
      }
    }
    if (module.releaseState === 'published') {
      const indexArtifact = module.artifacts.find((artifact) => artifact.kind === 'index');
      if (!module.sourceSetDigest || !indexArtifact?.url || !indexArtifact.sha256) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts'],
          message:
            'Published modules require an exact source set and a downloadable checksummed index.',
        });
      }
    }
  });

export const ContentModuleCatalogSchema = z
  .object({
    catalogVersion: z.string().min(1),
    channel: z.enum(['stable', 'preview']),
    publishedAt: z.string().min(1),
    modules: z.array(ContentModuleCatalogEntrySchema).min(1),
  })
  .superRefine((catalog, context) => {
    const moduleIds = new Set<string>();
    for (const [index, module] of catalog.modules.entries()) {
      if (moduleIds.has(module.id)) {
        context.addIssue({
          code: 'custom',
          path: ['modules', index, 'id'],
          message: `Duplicate module ID: ${module.id}`,
        });
      }
      moduleIds.add(module.id);
    }
    if (!catalog.modules.some((module) => module.kind === 'core' && module.required)) {
      context.addIssue({
        code: 'custom',
        path: ['modules'],
        message: 'A catalog requires at least one required core module.',
      });
    }
    for (const [index, module] of catalog.modules.entries()) {
      for (const dependency of module.dependencies) {
        if (!moduleIds.has(dependency.moduleId)) {
          context.addIssue({
            code: 'custom',
            path: ['modules', index, 'dependencies'],
            message: `Unknown module dependency: ${dependency.moduleId}`,
          });
        }
      }
    }
  });

export const ContentModuleValidationSchema = z.object({
  checkedAt: z.string().min(1),
  valid: z.boolean(),
  checksumValid: z.boolean(),
  schemaCompatible: z.boolean(),
  sqliteIntegrity: z.enum(['ok', 'failed', 'not-applicable']),
  message: z.string().min(1),
});

export const InstalledContentModuleSchema = z.object({
  moduleId: z.string().min(1),
  version: z.string().min(1),
  state: ContentModuleInstallStateSchema,
  enabled: z.boolean(),
  installedAt: z.string().min(1).nullable().default(null),
  installedSizeBytes: z.number().int().nonnegative().nullable().default(null),
  activeSourceSetDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .nullable()
    .default(null),
  previousVersions: z.array(z.string().min(1)).default([]),
  lastValidation: ContentModuleValidationSchema.nullable().default(null),
});

export const ContentModuleDownloadTaskSchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  version: z.string().min(1),
  state: z.enum([
    'queued',
    'downloading',
    'verifying',
    'installing',
    'completed',
    'failed',
    'cancelled',
  ]),
  downloadedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().nullable(),
  includeSourceAssets: z.boolean(),
  runsInBackground: z.boolean(),
  errorMessage: z.string().min(1).nullable().default(null),
});

export interface InstallContentModuleRequest {
  readonly moduleId: string;
  readonly version: string;
  readonly includeSourceAssets: boolean;
}

export interface ContentModuleManager {
  listCatalog(): Promise<Result<ContentModuleCatalog, LocalMedError>>;
  listInstalled(): Promise<Result<readonly InstalledContentModule[], LocalMedError>>;
  listDownloadTasks(): Promise<Result<readonly ContentModuleDownloadTask[], LocalMedError>>;
  install(
    request: InstallContentModuleRequest,
  ): Promise<Result<ContentModuleDownloadTask, LocalMedError>>;
  setEnabled(
    moduleId: string,
    enabled: boolean,
  ): Promise<Result<InstalledContentModule, LocalMedError>>;
  rollback(moduleId: string): Promise<Result<InstalledContentModule, LocalMedError>>;
  remove(moduleId: string): Promise<Result<void, LocalMedError>>;
}

export type ContentModuleKind = z.infer<typeof ContentModuleKindSchema>;
export type ContentModuleReleaseState = z.infer<typeof ContentModuleReleaseStateSchema>;
export type ContentModuleInstallState = z.infer<typeof ContentModuleInstallStateSchema>;
export type ContentModuleCatalogEntry = z.infer<typeof ContentModuleCatalogEntrySchema>;
export type ContentModuleCatalog = z.infer<typeof ContentModuleCatalogSchema>;
export type CoreCatalogTopicStub = z.infer<typeof CoreCatalogTopicStubSchema>;
export type InstalledContentModule = z.infer<typeof InstalledContentModuleSchema>;
export type ContentModuleDownloadTask = z.infer<typeof ContentModuleDownloadTaskSchema>;
