export function knowledgeDocumentBackHash(route: string): string | null {
  if (route.startsWith('modules/documents/category/')) {
    return '#/modules/documents/recommendations';
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
