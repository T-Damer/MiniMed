import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  MedicalDocumentSummary,
} from '@localmed/contracts';

import {
  parseModulePointerMetadata,
  selectModuleForPointer,
} from '@/features/modules/module-pointer-install';

/** The published module that holds the full text a source pointer stands for, if any. */
export function pointerModuleOf(
  document: MedicalDocumentSummary | undefined,
  catalog: ContentModuleCatalog,
): ContentModuleCatalogEntry | null {
  const pointer = parseModulePointerMetadata(document?.metadata);
  return pointer ? selectModuleForPointer(pointer, catalog) : null;
}

/**
 * One download offer per pack in a result list: the first result of a pack carries the download
 * chip, the later ones of the same pack only point at it. Maps a module id to that first result.
 */
export function packOfferOwners(
  documentIds: readonly string[],
  moduleIdOf: (documentId: string) => string | undefined,
): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const documentId of documentIds) {
    const moduleId = moduleIdOf(documentId);
    if (moduleId !== undefined && !owners.has(moduleId)) owners.set(moduleId, documentId);
  }
  return owners;
}
