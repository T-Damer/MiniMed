import type { DocumentReadRoute } from '@/state/document-route';

export function shouldReloadOfficialDocument(
  currentDocumentId: string | undefined,
  nextDocumentId: string,
  inFlightDocumentId: string | null,
): boolean {
  if (inFlightDocumentId === nextDocumentId) return false;
  if (currentDocumentId === nextDocumentId) return false;
  return true;
}

/**
 * True when two parsed document routes refer to the exact same document, section/page, and
 * optional exact-identity pin. Used to skip redundant `popstate` reloads when closing a modal,
 * popover, or sheet pops a history layer on the same document hash.
 */
export function isSameDocumentReadRoute(
  left: DocumentReadRoute | null | undefined,
  right: DocumentReadRoute | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind || left.documentId !== right.documentId) {
    return false;
  }
  if (left.kind === 'user' && right.kind === 'user') {
    return left.pageIndex === right.pageIndex;
  }
  if (left.kind === 'official' && right.kind === 'official') {
    if (left.section !== right.section) return false;
    const leftId = left.expectedIdentity;
    const rightId = right.expectedIdentity;
    if (leftId === rightId) return true;
    if (!leftId || !rightId) return false;
    return (
      leftId.documentId === rightId.documentId &&
      leftId.documentVersionId === rightId.documentVersionId &&
      leftId.sourceChecksum === rightId.sourceChecksum &&
      leftId.moduleId === rightId.moduleId &&
      leftId.moduleVersion === rightId.moduleVersion &&
      leftId.anchor === rightId.anchor
    );
  }
  return false;
}
