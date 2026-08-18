function withoutFullSuffix(documentId: string): string {
  return documentId.replace(/\.full$/u, '');
}

/** Minzdrav KR number without revision or topic suffix: `kr.rf.281_3.uti` → `kr.rf.281`. */
function clinicalRecommendationRoot(documentId: string): string | null {
  const match = /^(kr\.rf\.\d+)/u.exec(withoutFullSuffix(documentId));
  return match?.[1] ?? null;
}

function isPrefixedDocumentId(value: string, prefix: string): boolean {
  return value.startsWith(`${prefix}.`) || value.startsWith(`${prefix}_`);
}

/**
 * True when two ids are the same work: a summary, its full-text sibling, a revision, or a
 * topic card extracted from the same clinical recommendation.
 */
export function isSameDocumentFamily(leftId: string, rightId: string): boolean {
  if (leftId === rightId) return true;
  const left = withoutFullSuffix(leftId);
  const right = withoutFullSuffix(rightId);
  if (left === right) return true;
  if (isPrefixedDocumentId(left, right) || isPrefixedDocumentId(right, left)) return true;
  const leftRoot = clinicalRecommendationRoot(left);
  const rightRoot = clinicalRecommendationRoot(right);
  return Boolean(leftRoot && rightRoot && leftRoot === rightRoot);
}

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
  return withoutFullSuffix(documentId);
}

export function hasFullTextSibling(documentId: string, availableIds: ReadonlySet<string>): boolean {
  return isSupersededSummaryDocument(documentId, availableIds);
}
