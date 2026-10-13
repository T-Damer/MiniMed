import {
  type ClinicalEditionIndex,
  clinicalDocumentIdForEdition,
  clinicalEditionIdFromDocumentId,
  clinicalEditionIndex,
} from '@/features/modules/clinical-editions';

/**
 * The earlier editions of a document, nearest first: the documents whose highlights are carried
 * over when this one is opened. A clinical recommendation takes its chain from the editions
 * sidecar (`507_3`, `507_2` for `507_4`); any document can name what it replaces in
 * `metadata.supersedesDocumentIds`.
 */
export function earlierEditionDocumentIds(
  document: { readonly id: string; readonly metadata?: Readonly<Record<string, unknown>> },
  index: () => ClinicalEditionIndex = clinicalEditionIndex,
): readonly string[] {
  const ids: string[] = [];
  const editionId = clinicalEditionIdFromDocumentId(document.id);
  if (editionId) {
    const chain = index().chains.get(editionId);
    const own = chain?.find((edition) => edition.id === editionId);
    if (chain && own) {
      for (const edition of chain.toReversed()) {
        if (edition.version < own.version) ids.push(clinicalDocumentIdForEdition(edition.id));
      }
    }
  }
  const declared = document.metadata?.['supersedesDocumentIds'];
  if (Array.isArray(declared)) {
    for (const value of declared) {
      if (typeof value === 'string' && value !== document.id) ids.push(value);
    }
  }
  return [...new Set(ids)];
}
