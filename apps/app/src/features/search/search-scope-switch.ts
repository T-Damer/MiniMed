import type {
  MedicalDocumentSummary,
  SearchResponse,
  SearchResultGroup,
} from '@localmed/contracts';

import { documentMatchesSearchScope, type SearchScope } from '@/features/search/ScopedMedicalCore';

function groupMatchesScopeFallback(group: SearchResultGroup, scope: SearchScope): boolean {
  if (scope === 'all') return true;
  if (scope === 'medications') {
    return group.documentType === 'medication' || group.documentKind === 'medication';
  }
  if (scope === 'guidelines') {
    return (
      group.documentType === 'clinical-recommendation' ||
      group.documentKind === 'clinical-recommendation'
    );
  }
  if (scope === 'legal') {
    return (
      group.documentType === 'order' ||
      group.documentType === 'law' ||
      group.documentType === 'legal' ||
      group.documentKind === 'legal'
    );
  }
  if (scope === 'calculators') {
    return group.documentType === 'calculator' || group.documentKind === 'calculator';
  }
  if (scope === 'assessments') {
    return group.documentType === 'assessment' || group.documentKind === 'assessment';
  }
  if (scope === 'icd11') {
    return group.documentType === 'icd11';
  }
  if (scope === 'conditions') {
    return group.documentType === 'icd10' || group.documentType === 'reference';
  }
  return false;
}

/**
 * Narrows an already visible search response to `nextScope` while the full scoped search runs in
 * the background, so switching sections never wipes the current query or flashes an empty screen.
 *
 * Returns `undefined` when no previous results can be classified into `nextScope`, letting the
 * caller show a clean scoped loading state instead of stale cross-section hits.
 */
export function narrowSearchResponseForScope(
  previous: SearchResponse | undefined,
  nextScope: SearchScope,
  documentsById: ReadonlyMap<string, Pick<MedicalDocumentSummary, 'sourceType' | 'metadata'>>,
): SearchResponse | undefined {
  if (!previous) return undefined;
  if (nextScope === 'all') {
    return { ...previous, partial: true };
  }
  const matchedById = new Map(
    (previous.matchedDocuments ?? []).map((descriptor) => [descriptor.id, descriptor] as const),
  );
  const matchingGroups = previous.groups.filter((group) => {
    const known = documentsById.get(group.documentId) ?? matchedById.get(group.documentId);
    if (known) return documentMatchesSearchScope(known, nextScope);
    return groupMatchesScopeFallback(group, nextScope);
  });
  if (matchingGroups.length === 0) return undefined;
  return {
    ...previous,
    partial: true,
    groups: matchingGroups,
  };
}
