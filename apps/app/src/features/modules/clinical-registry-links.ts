const CLINICAL_REGISTRY_ORIGIN = 'https://cr.minzdrav.gov.ru';
export const CLINICAL_REGISTRY_URL = `${CLINICAL_REGISTRY_ORIGIN}/clin-rec/`;

export function clinicalRecommendationSourceUrl(documentId: string): string | undefined {
  const edition = /^kr\.rf\.(\d+_\d+)$/u.exec(documentId)?.[1];
  return edition ? `${CLINICAL_REGISTRY_ORIGIN}/view-cr/${edition}` : undefined;
}
