import type { MedicalDocumentSummary } from '@localmed/contracts';
import { isIcd11Document } from '@/features/icd11/icd11-document';
import {
  type SearchResultDocumentKind,
  searchResultDocumentKind,
} from '@/features/search/ScopedMedicalCore';

const KIND_RANK: Readonly<Record<SearchResultDocumentKind, number>> = {
  'clinical-recommendation': 0,
  reference: 1,
  legal: 2,
  medication: 3,
  calculator: 4,
  assessment: 4,
};

const ICD11_RANK = 5;

/** Browsing order for the unfiltered home catalog: guidelines first, chemical-name noise last. */
export function homeDocumentOrder(
  documents: readonly MedicalDocumentSummary[],
): readonly MedicalDocumentSummary[] {
  return documents
    .map((document, index) => ({
      document,
      index,
      // The optional WHO ICD-11 pack (tens of thousands of code cards) never leads the catalog.
      kind: isIcd11Document(document) ? ICD11_RANK : KIND_RANK[searchResultDocumentKind(document)],
      // Titles such as “1-(4-БРОМФЕНИЛ)…” sort before every word under COLLATE NOCASE.
      symbolic: /^\P{L}/u.test(document.title.trim()) ? 1 : 0,
    }))
    .toSorted(
      (left, right) =>
        left.kind - right.kind || left.symbolic - right.symbolic || left.index - right.index,
    )
    .map((entry) => entry.document);
}
