import { normalizeSurfaceText } from '@localmed/search-lexical';
import { cosineInt8, embedPortableText } from '@localmed/search-semantic';

import type { FrozenCandidateRow } from './linear-reranker-baseline';

export function frozenCandidateText(row: FrozenCandidateRow): string {
  const identitySurfaces = [
    row.candidate.canonicalName,
    row.candidate.shortTitle,
    ...row.candidate.navigationAliases,
    ...row.candidate.declaredAliases,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const seen = new Set<string>();
  const uniqueIdentitySurfaces = identitySurfaces.filter((value) => {
    const normalized = normalizeSurfaceText(value);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  return [...uniqueIdentitySurfaces, row.candidate.evidence]
    .filter((value) => value.trim().length > 0)
    .join('\n');
}

export function portableEmbeddingCandidateScore(query: string, row: FrozenCandidateRow): number {
  const queryVector = embedPortableText(query);
  const candidateVector = embedPortableText(frozenCandidateText(row));
  return cosineInt8(
    queryVector.values,
    candidateVector.values,
    queryVector.norm,
    candidateVector.norm,
  );
}

export function rerankPortableEmbeddingCandidates(
  rows: readonly FrozenCandidateRow[],
): readonly FrozenCandidateRow[] {
  const first = rows[0];
  if (!first) return [];
  if (rows.some((row) => row.query !== first.query)) {
    throw new Error('Portable embedding reranker requires one frozen query per candidate group.');
  }

  const queryVector = embedPortableText(first.query);
  return rows
    .map((row) => {
      const candidateVector = embedPortableText(frozenCandidateText(row));
      return {
        row,
        score: cosineInt8(
          queryVector.values,
          candidateVector.values,
          queryVector.norm,
          candidateVector.norm,
        ),
      };
    })
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.row.retrieval.originalRank - right.row.retrieval.originalRank,
    )
    .map((entry) => entry.row);
}
