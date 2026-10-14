import type { SearchAtcMatch, SearchResultGroup } from '@localmed/contracts';
import { parseAtcQuery } from '@localmed/search-lexical';

/**
 * Drug pickers ask the ordinary drug search for a typed text; when the text is an ATC code or
 * prefix the core answers with the drugs that carry it, each group marked `atcMatch` (ATC5). These
 * helpers read that answer for a picker that needs one drug.
 */

/** The groups the core found by the typed code, in its order (exact level first, then by name). */
export function atcGroups(groups: readonly SearchResultGroup[]): readonly SearchResultGroup[] {
  return groups.filter((group) => group.atcMatch !== undefined);
}

/**
 * The one drug a typed text names by its code out of `found` (the drugs the code search returned,
 * in its order), or null. A full code (`J05AB01`) names its first drug; a group prefix (`J05`) names
 * a drug only when it holds exactly one, so a picker never guesses among many.
 */
export function singleByCode<T>(text: string, found: readonly T[]): T | null {
  const query = parseAtcQuery(text);
  if (!query) return null;
  if (found.length === 1) return found[0] ?? null;
  return query.code.length === 7 ? (found[0] ?? null) : null;
}

/** `singleByCode` over the groups of a search response. */
export function singleAtcGroup(
  text: string,
  groups: readonly SearchResultGroup[],
): SearchResultGroup | null {
  return singleByCode(text, atcGroups(groups));
}

/** The match of a group that has one, as an optional property for a candidate object. */
export function atcMatchOf(group: Pick<SearchResultGroup, 'atcMatch'>): {
  readonly atc?: SearchAtcMatch;
} {
  return group.atcMatch ? { atc: group.atcMatch } : {};
}
