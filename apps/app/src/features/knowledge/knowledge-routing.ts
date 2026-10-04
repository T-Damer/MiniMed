import {
  atcParentCode,
  MEDICATION_ATC_ROUTE,
  medicationAtcHash,
  medicationCatalogViewFromHash,
} from '@/features/medications/medication-routing';
import { isDocumentReadRoute } from '@/state/document-route';

/** Intra-catalog hashes that should reset window scroll without touching root-tab restore. */
export function shouldResetKnowledgeCatalogScroll(hash: string): boolean {
  const route = hash.replace(/^#\/?/u, '');
  if (isDocumentReadRoute(hash)) return false;
  return (
    route === 'modules' || route === 'modules/documents' || route.startsWith('modules/documents/')
  );
}

export function knowledgeDocumentBackHash(route: string): string | null {
  const conditionDetailMatch = route.match(
    /^modules\/documents\/conditions\/(diseases|conditions|syndromes|symptoms)\//u,
  );
  if (conditionDetailMatch?.[1]) {
    return `#/modules/documents/conditions/${conditionDetailMatch[1]}`;
  }
  if (
    route === 'modules/documents/conditions' ||
    /^modules\/documents\/conditions\/(diseases|conditions|syndromes|symptoms)$/u.test(route)
  ) {
    return '#/modules/documents';
  }
  if (route === MEDICATION_ATC_ROUTE || route.startsWith(`${MEDICATION_ATC_ROUTE}/`)) {
    // One level up the ATC tree; the list of groups goes back to the knowledge base.
    const view = medicationCatalogViewFromHash(route);
    const code = view.view === 'atc' ? view.code : null;
    const parent = code ? atcParentCode(code) : null;
    return code ? medicationAtcHash(parent) : '#/modules/documents';
  }
  if (route.startsWith('modules/documents/category/')) {
    return '#/modules/documents/recommendations';
  }
  if (route.startsWith('modules/documents/laws/')) {
    return '#/modules/documents/collection/regulatory';
  }
  if (route === 'modules/documents/recommendations') {
    return '#/modules/documents';
  }
  if (route.startsWith('modules/documents/d/')) {
    return null;
  }
  if (route === 'modules/documents/user') {
    return '#/modules/documents';
  }
  if (route.startsWith('modules/documents/user?')) {
    return '#/modules/documents/user';
  }
  if (route.startsWith('modules/documents/user/')) {
    return '#/modules/documents/user';
  }
  if (route.startsWith('modules/documents/')) {
    return '#/modules/documents';
  }
  if (route === 'modules/documents') {
    return null;
  }
  if (route === 'modules/model' || route === 'status') {
    return null;
  }
  return null;
}
