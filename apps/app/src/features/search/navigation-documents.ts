import type { MedicalDocumentSummary } from '@localmed/contracts';

import { parseModulePointerMetadata } from '@/features/modules/module-pointer-install';

/**
 * The documents a catalog or a section counter lists, each entity once. The medical core mounts
 * the core's source pointers next to every installed module, so one document can arrive several
 * times: as the pointer that stands for it, and as the real document of each installed module that
 * carries it (a recommendation belongs to several specialty modules). Installing a module must
 * replace a pointer, not add to it, so counters do not grow with every install.
 */
export function distinctNavigationDocuments(
  documents: readonly MedicalDocumentSummary[],
): readonly MedicalDocumentSummary[] {
  const real = new Set<string>();
  for (const document of documents) {
    if (!parseModulePointerMetadata(document.metadata)) real.add(document.id);
  }
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (seen.has(document.id)) return false;
    seen.add(document.id);
    const pointer = parseModulePointerMetadata(document.metadata);
    return !pointer || !real.has(pointer.targetDocumentId);
  });
}
