/** Pilot summaries use `.full` sibling packs for the verbatim clinical text. */
export function fullDocumentCandidateId(documentId: string): string {
  if (documentId.endsWith('.full')) return documentId;
  return `${documentId}.full`;
}

export function fullDocumentCandidateIds(documentId: string): readonly string[] {
  const clinicalId = /^(kr\.rf\.\d+_\d+)(?:\.|$)/u.exec(documentId)?.[1];
  return [
    ...(clinicalId && clinicalId !== documentId ? [clinicalId] : []),
    fullDocumentCandidateId(documentId),
  ].filter(
    (candidate, index, values) => candidate !== documentId && values.indexOf(candidate) === index,
  );
}

export function resolveReadableDocumentId(
  documentId: string,
  availableIds: ReadonlySet<string>,
): string {
  return (
    fullDocumentCandidateIds(documentId).find((candidate) => availableIds.has(candidate)) ??
    documentId
  );
}

export function isSupersededSummaryDocument(
  documentId: string,
  availableIds: ReadonlySet<string>,
): boolean {
  return resolveReadableDocumentId(documentId, availableIds) !== documentId;
}

export function summaryDocumentId(documentId: string): string {
  return documentId.replace(/\.full$/, '');
}

export function hasFullTextSibling(documentId: string, availableIds: ReadonlySet<string>): boolean {
  return isSupersededSummaryDocument(documentId, availableIds);
}
