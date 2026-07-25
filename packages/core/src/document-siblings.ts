/** Pilot summaries use `.full` sibling packs for the verbatim clinical text. */
export function fullDocumentCandidateId(documentId: string): string {
  if (documentId.endsWith('.full')) return documentId;
  return `${documentId}.full`;
}

export function resolveReadableDocumentId(
  documentId: string,
  availableIds: ReadonlySet<string>,
): string {
  const fullId = fullDocumentCandidateId(documentId);
  return fullId !== documentId && availableIds.has(fullId) ? fullId : documentId;
}

export function isSupersededSummaryDocument(
  documentId: string,
  availableIds: ReadonlySet<string>,
): boolean {
  return !documentId.endsWith('.full') && availableIds.has(fullDocumentCandidateId(documentId));
}

export function summaryDocumentId(documentId: string): string {
  return documentId.replace(/\.full$/, '');
}

export function hasFullTextSibling(
  documentId: string,
  availableIds: ReadonlySet<string>,
): boolean {
  return isSupersededSummaryDocument(documentId, availableIds);
}
