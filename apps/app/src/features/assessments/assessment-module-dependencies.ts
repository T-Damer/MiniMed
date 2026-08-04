import type { MedicalStore } from '@localmed/storage';

import { assessmentIdsReferencedInText } from '@/features/tool-links/document-tool-links';

type AssessmentDependencyStore = Pick<MedicalStore, 'getChunksByDocument' | 'listDocuments'>;

export async function findAssessmentDependenciesInStore(
  store: AssessmentDependencyStore,
): Promise<readonly string[]> {
  const assessmentIds = new Set<string>();
  const documents = await store.listDocuments();

  for (const document of documents) {
    for (const id of assessmentIdsReferencedInText(
      [document.title, document.shortTitle ?? ''].join('\n'),
    )) {
      assessmentIds.add(id);
    }
    const chunks = await store.getChunksByDocument(document.id);
    for (const chunk of chunks) {
      for (const id of assessmentIdsReferencedInText(chunk.originalText)) assessmentIds.add(id);
    }
  }

  return [...assessmentIds].toSorted();
}
