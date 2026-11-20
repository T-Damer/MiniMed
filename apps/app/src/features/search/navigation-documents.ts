import type { MedicalDocumentSummary } from '@localmed/contracts';
import { isSupersededSummaryDocument } from '@localmed/core';
import { createTimeSlicer } from '@localmed/search-lexical';

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

/** Prepare a complete catalog without monopolizing the thread while a section is opening. */
export async function prepareNavigationDocuments(
  documents: readonly MedicalDocumentSummary[],
  signal: AbortSignal,
): Promise<readonly MedicalDocumentSummary[] | undefined> {
  const slice = createTimeSlicer();
  const available = new Set<string>();
  for (const document of documents) {
    available.add(document.id);
  }
  const real = new Set<string>();
  for (const document of documents) {
    if (
      !isSupersededSummaryDocument(document.id, available) &&
      !parseModulePointerMetadata(document.metadata)
    )
      real.add(document.id);
    const due = slice();
    if (due) await due;
    if (signal.aborted) return undefined;
  }
  const seen = new Set<string>();
  const readable: MedicalDocumentSummary[] = [];
  for (const document of documents) {
    if (!seen.has(document.id) && !isSupersededSummaryDocument(document.id, available)) {
      seen.add(document.id);
      const pointer = parseModulePointerMetadata(document.metadata);
      if (!pointer || !real.has(pointer.targetDocumentId)) readable.push(document);
    }
    const due = slice();
    if (due) await due;
    if (signal.aborted) return undefined;
  }
  return readable;
}
