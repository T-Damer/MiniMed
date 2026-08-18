import { isCloseToken, MIN_FUZZY_TOKEN_LENGTH } from '@localmed/search-lexical';

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function tokens(value: string): readonly string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function tokenMatches(queryToken: string, hayToken: string): boolean {
  if (hayToken.includes(queryToken) || (queryToken.length >= 3 && queryToken.includes(hayToken))) {
    return true;
  }
  if (queryToken.length < MIN_FUZZY_TOKEN_LENGTH && hayToken.length < MIN_FUZZY_TOKEN_LENGTH) {
    return queryToken === hayToken;
  }
  return isCloseToken(queryToken, hayToken);
}

/** Inexact catalog/field matching: substring first, then bounded-edit token matches. */
export function matchesFuzzyQuery(query: string, values: readonly string[]): boolean {
  return fuzzyQueryScore(query, values) > 0 || tokens(query).length === 0;
}

/**
 * Higher is a closer catalog hit. Exact/prefix title beats a mention in a secondary field.
 * Returns 0 when the query does not match.
 */
export function fuzzyQueryScore(query: string, values: readonly string[]): number {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 1;
  const title = normalize(values[0] ?? '');
  const haystack = normalize(values.join(' '));
  const hayTokens = tokens(haystack);
  const matched = queryTokens.every(
    (queryToken) =>
      haystack.includes(queryToken) ||
      hayTokens.some((hayToken) => tokenMatches(queryToken, hayToken)),
  );
  if (!matched) return 0;

  const normalizedQuery = normalize(query);
  if (title === normalizedQuery) return 100;
  if (title.startsWith(normalizedQuery)) return 80;
  if (title.includes(normalizedQuery)) return 55;
  if (haystack.startsWith(normalizedQuery) || haystack.includes(` ${normalizedQuery}`)) return 35;
  if (haystack.includes(normalizedQuery)) return 20;
  return 10;
}
