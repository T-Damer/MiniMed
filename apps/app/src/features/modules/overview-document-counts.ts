import type { MedicalDocumentSummary } from '@localmed/contracts';

import { ICD11_SOURCE_TYPE } from '@/features/icd11/icd11-document';
import { documentMatchesSearchScope } from '@/features/search/ScopedMedicalCore';

export type DocumentOverviewBucket =
  | 'medications'
  | 'reference'
  | 'regulatory'
  | 'clinical'
  | 'core';

export type OverviewDocumentCounts = Readonly<Record<DocumentOverviewBucket, number>>;

export const EMPTY_OVERVIEW_DOCUMENT_COUNTS: OverviewDocumentCounts = {
  medications: 0,
  reference: 0,
  regulatory: 0,
  clinical: 0,
  core: 0,
};

export function overviewBucketForSourceType(sourceType: string): DocumentOverviewBucket {
  if (documentMatchesSearchScope({ sourceType }, 'medications')) return 'medications';
  if (documentMatchesSearchScope({ sourceType }, 'legal')) return 'regulatory';
  if (
    sourceType === 'clinical_recommendation' ||
    sourceType === 'clinical_recommendation_summary'
  ) {
    return 'clinical';
  }
  // ICD-11 is an optional reference pack: it must not inflate the discovery core's count.
  if (sourceType === 'medical_reference' || sourceType === ICD11_SOURCE_TYPE) return 'reference';
  return 'core';
}

export function countDocumentsByOverviewBucket(
  documents: readonly Pick<MedicalDocumentSummary, 'sourceType'>[],
): OverviewDocumentCounts {
  const counts = {
    medications: 0,
    reference: 0,
    regulatory: 0,
    clinical: 0,
    core: 0,
  };
  for (const document of documents) {
    counts[overviewBucketForSourceType(document.sourceType)] += 1;
  }
  return counts;
}
