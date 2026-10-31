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
