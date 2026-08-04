import type { MedicalStore } from '@localmed/storage';

import { ASSESSMENT_CATALOG } from '@/features/assessments/assessment-catalog';
import { assessmentIdsReferencedInText } from '@/features/tool-links/document-tool-links';

type AssessmentDependencyStore = Pick<MedicalStore, 'getChunksByDocument' | 'listDocuments'>;

const MAX_PARALLEL_DOCUMENT_READS = 4;
const KNOWN_ASSESSMENT_COUNT = ASSESSMENT_CATALOG.length;

function collectAssessmentIds(text: string, target: Set<string>): void {
  for (const id of assessmentIdsReferencedInText(text)) target.add(id);
}

export async function findAssessmentDependenciesInStore(
  store: AssessmentDependencyStore,
): Promise<readonly string[]> {
  const assessmentIds = new Set<string>();
  const documents = await store.listDocuments();

  for (const document of documents) {
    collectAssessmentIds([document.title, document.shortTitle ?? ''].join('\n'), assessmentIds);
  }
  if (assessmentIds.size >= KNOWN_ASSESSMENT_COUNT) return [...assessmentIds].toSorted();

  let nextDocumentIndex = 0;
  const scanDocuments = async (): Promise<void> => {
    while (nextDocumentIndex < documents.length && assessmentIds.size < KNOWN_ASSESSMENT_COUNT) {
      const document = documents[nextDocumentIndex++];
      if (!document) return;
      const chunks = await store.getChunksByDocument(document.id);
      for (const chunk of chunks) {
        collectAssessmentIds(chunk.originalText, assessmentIds);
        if (assessmentIds.size >= KNOWN_ASSESSMENT_COUNT) return;
      }
    }
  };

  const workerCount = Math.min(MAX_PARALLEL_DOCUMENT_READS, documents.length);
  await Promise.all(Array.from({ length: workerCount }, () => scanDocuments()));
  return [...assessmentIds].toSorted();
}
