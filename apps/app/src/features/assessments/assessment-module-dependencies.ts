import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import type { MedicalStore } from '@localmed/storage';

import { getAssessmentCatalog } from '@/features/assessments/assessment-catalog';
import { resolveDeclaredAssessmentDependencies } from '@/features/assessments/assessment-module-manifest';
import { getActiveContentModuleCatalog } from '@/features/modules/catalog-service';
import { assessmentIdsReferencedInText } from '@/features/tool-links/document-tool-links';

type AssessmentDependencyStore = Pick<MedicalStore, 'getChunksByDocument' | 'listDocuments'> &
  Partial<Pick<MedicalStore, 'getHealth'>>;
type AssessmentModuleDescriptor = Pick<ContentModuleCatalogEntry, 'id' | 'kind' | 'tags'>;

export interface AssessmentDependencyScanOptions {
  readonly modules?: readonly AssessmentModuleDescriptor[];
  readonly onDeclarationError?: (moduleId: string, cause: unknown) => void;
}

const MAX_PARALLEL_DOCUMENT_READS = 4;

function knownAssessmentCount(): number {
  return getAssessmentCatalog().length;
}

function collectAssessmentIds(text: string, target: Set<string>): void {
  for (const id of assessmentIdsReferencedInText(text)) target.add(id);
}

function reportDeclarationError(
  options: AssessmentDependencyScanOptions,
  moduleId: string,
  cause: unknown,
): void {
  if (options.onDeclarationError) {
    options.onDeclarationError(moduleId, cause);
    return;
  }
  console.warn(
    `Unable to resolve declared questionnaire dependencies for ${moduleId}; falling back to content scan.`,
    cause,
  );
}

async function declaredDependencies(
  store: AssessmentDependencyStore,
  options: AssessmentDependencyScanOptions,
): Promise<readonly string[] | null> {
  if (!store.getHealth) return null;
  let contentPackIds: readonly string[];
  try {
    contentPackIds = (await store.getHealth()).contentPackIds;
  } catch (cause) {
    reportDeclarationError(options, 'unknown', cause);
    return null;
  }
  if (contentPackIds.length !== 1) return null;

  const moduleId = contentPackIds[0];
  if (!moduleId) return null;
  const modules = options.modules ?? getActiveContentModuleCatalog().modules;
  const descriptor = modules.find((module) => module.id === moduleId);
  if (descriptor?.kind !== 'clinical') return null;

  try {
    return resolveDeclaredAssessmentDependencies(descriptor.tags, getAssessmentCatalog());
  } catch (cause) {
    reportDeclarationError(options, moduleId, cause);
    return null;
  }
}

export async function findAssessmentDependenciesInStore(
  store: AssessmentDependencyStore,
  options: AssessmentDependencyScanOptions = {},
): Promise<readonly string[]> {
  const declared = await declaredDependencies(store, options);
  if (declared !== null) return declared;

  const assessmentIds = new Set<string>();
  const documents = await store.listDocuments();

  for (const document of documents) {
    collectAssessmentIds([document.title, document.shortTitle ?? ''].join('\n'), assessmentIds);
  }
  if (knownAssessmentCount() > 0 && assessmentIds.size >= knownAssessmentCount()) {
    return [...assessmentIds].toSorted();
  }

  let nextDocumentIndex = 0;
  const scanDocuments = async (): Promise<void> => {
    const targetCount = knownAssessmentCount();
    while (nextDocumentIndex < documents.length) {
      if (targetCount > 0 && assessmentIds.size >= targetCount) return;
      const document = documents[nextDocumentIndex++];
      if (!document) return;
      const chunks = await store.getChunksByDocument(document.id);
      for (const chunk of chunks) {
        collectAssessmentIds(chunk.originalText, assessmentIds);
        if (targetCount > 0 && assessmentIds.size >= targetCount) return;
      }
    }
  };

  const workerCount = Math.min(MAX_PARALLEL_DOCUMENT_READS, documents.length);
  await Promise.all(Array.from({ length: workerCount }, () => scanDocuments()));
  return [...assessmentIds].toSorted();
}
