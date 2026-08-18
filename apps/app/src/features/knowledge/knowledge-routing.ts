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
