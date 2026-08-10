export function knowledgeDocumentBackHash(route: string): string | null {
  if (route.startsWith('modules/documents/category/')) {
    return '#/modules/documents/recommendations';
  }
  return route.startsWith('modules/documents/') ? '#/modules/documents' : null;
}
