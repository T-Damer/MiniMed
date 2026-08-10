import type { TextRange } from '@localmed/contracts';
import type { AliasRecord } from '@localmed/domain';

import { isCloseToken, MIN_FUZZY_TOKEN_LENGTH, normalizeSurfaceText, tokenize } from './normalize';

export type AliasMatchType = 'exact' | 'fuzzy';

export interface AliasMatchSpan {
  readonly alias: AliasRecord;
  readonly range: TextRange;
  readonly matchType: AliasMatchType;
}

export interface AliasExpansion {
  readonly terms: readonly string[];
  readonly matches: readonly string[];
  readonly matchedAliases: readonly AliasRecord[];
  /** Same matches as `matchedAliases`, but with the query span each one matched — exact or fuzzy. */
  readonly matchSpans: readonly AliasMatchSpan[];
}

export function findNormalizedPhraseIndex(text: string, phrase: string): number {
  if (!phrase) return -1;
  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`(?:^|[^0-9a-zа-я])(${escapedPhrase})(?![0-9a-zа-я])`, 'u').exec(text);
  const matchedPhrase = match?.[1];
  if (!match || !matchedPhrase) return -1;
  return match.index + match[0].length - matchedPhrase.length;
}

/**
 * Bag-of-words fallback for when the alias phrase does not appear verbatim: every significant
 * token of the phrase must have a close (exact or bounded-edit-distance) match somewhere in the
 * query. Requires at least one token long enough to be fuzzy-eligible, so short abbreviations
 * (e.g. "ОАК", "АД") never fall back to fuzzy matching — only genuinely misspelled/inflected
 * clinical words do. Returns the span covering the matched query tokens (in `normalizedQuery`
 * coordinates), used for downstream negation-overlap checks.
 */
export function fuzzyPhraseSpan(
  normalizedQuery: string,
  normalizedPhrase: string,
): TextRange | null {
  const phraseTokens = tokenize(normalizedPhrase);
  if (phraseTokens.length === 0) return null;
  if (!phraseTokens.some((token) => token.length >= MIN_FUZZY_TOKEN_LENGTH)) return null;

  const queryTokens = tokenize(normalizedQuery);
  const usedQueryTokenIndexes = new Set<number>();
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const phraseToken of phraseTokens) {
    const matchIndex = queryTokens.findIndex(
      (queryToken, index) =>
        !usedQueryTokenIndexes.has(index) && isCloseToken(phraseToken, queryToken),
    );
    if (matchIndex < 0) return null;
    usedQueryTokenIndexes.add(matchIndex);

    const matchedToken = queryTokens[matchIndex];
    if (!matchedToken) return null;
    const tokenIndex = findNormalizedPhraseIndex(normalizedQuery, matchedToken);
    if (tokenIndex < 0) return null;
    start = Math.min(start, tokenIndex);
    end = Math.max(end, tokenIndex + matchedToken.length);
  }

  return { start, end };
}

export function expandAliases(query: string, aliases: readonly AliasRecord[]): AliasExpansion {
  const normalizedQuery = normalizeSurfaceText(query);
  const terms = new Set<string>();
  const matches: string[] = [];
  const matchedAliases: AliasRecord[] = [];
  const matchSpans: AliasMatchSpan[] = [];

  for (const alias of aliases.toSorted((left, right) => right.alias.length - left.alias.length)) {
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    const exactIndex = findNormalizedPhraseIndex(normalizedQuery, normalizedAlias);
    const matchType: AliasMatchType = exactIndex >= 0 ? 'exact' : 'fuzzy';
    const span: TextRange | null =
      exactIndex >= 0
        ? { start: exactIndex, end: exactIndex + normalizedAlias.length }
        : fuzzyPhraseSpan(normalizedQuery, normalizedAlias);
    if (!span) continue;

    matches.push(`${alias.alias} → ${alias.canonicalTerm}`);
    matchedAliases.push(alias);
    matchSpans.push({ alias, range: span, matchType });
    for (const term of tokenize(alias.canonicalTerm)) terms.add(term);
  }

  return { terms: [...terms], matches, matchedAliases, matchSpans };
}
