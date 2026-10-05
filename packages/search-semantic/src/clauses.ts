import type { SemanticFusion } from './portable-hash';

/** At most this many clauses are embedded besides the whole query. */
export const MAX_QUERY_CLAUSES = 4;

/**
 * The separate statements of a free-text complaint, in the user's own wording: split at sentence
 * punctuation, commas, semicolons and line breaks; a clause needs two words or eight letters.
 * Fewer than two clauses returns none, since the whole query already covers one statement.
 */
export function queryClauses(text: string): readonly string[] {
  const clauses = text
    .split(/[.;!?\n]+|,\s*/u)
    .map((clause) => clause.trim().replace(/\s+/gu, ' '))
    .filter((clause) => clause.split(' ').length >= 2 || clause.replace(/\P{L}/gu, '').length >= 8)
    .filter((clause, index, all) => all.indexOf(clause) === index);
  return clauses.length >= 2 ? clauses.slice(0, MAX_QUERY_CLAUSES) : [];
}

export interface ScoredChunk {
  readonly chunkId: string;
  readonly documentId: string;
  /** Cosine against one query vector. */
  readonly score: number;
}

/**
 * Semantic strength (0…1, or the raw cosine without a band) of every chunk found by the whole
 * query (`lists[0]`) or by a clause (`lists[1…]`), relative to each list's best cosine. With
 * clauses and `clauseCoverageWeight`, documents answering more clauses rise.
 */
export function semanticStrengths(
  lists: readonly (readonly ScoredChunk[])[],
  fusion: SemanticFusion,
): ReadonlyMap<string, number> {
  const strengthIn = (list: readonly ScoredChunk[]) => {
    const best = Math.max(0, ...list.map((hit) => hit.score));
    return new Map(
      list.map((hit) => [
        hit.chunkId,
        fusion.band === undefined
          ? Math.max(0, hit.score)
          : Math.max(0, Math.min(1, (hit.score - (best - fusion.band)) / fusion.band)),
      ]),
    );
  };
  const perList = lists.map(strengthIn);
  const strongest = new Map<string, number>();
  const documentOf = new Map<string, string>();
  for (const [index, list] of lists.entries()) {
    for (const hit of list) {
      documentOf.set(hit.chunkId, hit.documentId);
      const value = perList[index]?.get(hit.chunkId) ?? 0;
      strongest.set(hit.chunkId, Math.max(strongest.get(hit.chunkId) ?? 0, value));
    }
  }
  const weight = fusion.clauseCoverageWeight ?? 0;
  const clauseLists = lists.slice(1);
  if (weight <= 0 || clauseLists.length < 2) return strongest;

  const coverage = new Map<string, number>();
  for (const [offset, list] of clauseLists.entries()) {
    const strengths = perList[offset + 1];
    const bestByDocument = new Map<string, number>();
    for (const hit of list) {
      const value = strengths?.get(hit.chunkId) ?? 0;
      bestByDocument.set(hit.documentId, Math.max(bestByDocument.get(hit.documentId) ?? 0, value));
    }
    for (const [documentId, value] of bestByDocument) {
      coverage.set(documentId, (coverage.get(documentId) ?? 0) + value / clauseLists.length);
    }
  }
  return new Map(
    [...strongest].map(([chunkId, value]) => [
      chunkId,
      (1 - weight) * value + weight * (coverage.get(documentOf.get(chunkId) ?? '') ?? 0),
    ]),
  );
}
