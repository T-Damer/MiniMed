import type { MedicalDocumentSummary } from '@localmed/contracts';

import {
  buildConditionCatalog,
  type ConditionCatalogEntry,
  type ConditionCatalogSource,
} from '@/features/conditions/condition-catalog';
import { distinctNavigationDocuments } from '@/features/search/navigation-documents';
import { hashWithSearchQuery } from '@/features/search/search-query-route';

/**
 * A condition's documents in the app. The links come from the condition catalog the app already
 * builds from the core (МКБ-10 codes → clinical recommendations and reference articles); nothing is
 * searched anew and nothing is invented. A class without a code, or a code the installed modules do
 * not carry, still gets the ordinary search for the condition's name.
 */
export interface SkinDocumentLink {
  readonly documentId: string;
  readonly title: string;
  readonly kind: ConditionCatalogSource['kind'];
}

export const MAX_SKIN_DOCUMENT_LINKS = 4;

const KIND_ORDER: Record<ConditionCatalogSource['kind'], number> = {
  recommendation: 0,
  reference: 1,
  classification: 2,
};

export const SKIN_DOCUMENT_KIND_LABELS: Record<ConditionCatalogSource['kind'], string> = {
  recommendation: 'Клинические рекомендации',
  reference: 'Статья',
  classification: 'МКБ-10',
};

/** `L40` covers `L40.0` and `L40.9`; `L30.9` is covered by `L30`. A code range is no single disease. */
export function icdCodesRelated(wanted: string, found: string): boolean {
  if (found.includes('-') || wanted.includes('-')) return false;
  if (wanted === found) return true;
  return found.startsWith(`${wanted}.`) || wanted.startsWith(`${found}.`);
}

export function buildSkinCatalog(
  documents: readonly MedicalDocumentSummary[],
): readonly ConditionCatalogEntry[] {
  return buildConditionCatalog(distinctNavigationDocuments(documents));
}

export function skinClassDocumentLinks(
  catalog: readonly ConditionCatalogEntry[],
  codes: readonly string[],
): readonly SkinDocumentLink[] {
  if (codes.length === 0) return [];
  const links = new Map<string, SkinDocumentLink>();
  for (const entry of catalog) {
    if (!entry.codes.some((found) => codes.some((wanted) => icdCodesRelated(wanted, found)))) {
      continue;
    }
    for (const source of entry.sources) {
      if (!links.has(source.documentId)) {
        links.set(source.documentId, {
          documentId: source.documentId,
          title: source.title,
          kind: source.kind,
        });
      }
    }
  }
  return [...links.values()]
    .toSorted(
      (left, right) =>
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
        left.title.localeCompare(right.title, 'ru'),
    )
    .slice(0, MAX_SKIN_DOCUMENT_LINKS);
}

/** The app's own search address for a condition's name. */
export function skinSearchHash(name: string): string {
  return hashWithSearchQuery('#/search', name);
}
