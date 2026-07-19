import type { AliasRecord } from '@localmed/domain';

import { normalizeSurfaceText, tokenize } from './normalize';

export interface AliasExpansion {
  readonly terms: readonly string[];
  readonly matches: readonly string[];
  readonly matchedAliases: readonly AliasRecord[];
}

export function expandAliases(query: string, aliases: readonly AliasRecord[]): AliasExpansion {
  const normalizedQuery = normalizeSurfaceText(query);
  const terms = new Set<string>();
  const matches: string[] = [];
  const matchedAliases: AliasRecord[] = [];

  for (const alias of aliases.toSorted((left, right) => right.alias.length - left.alias.length)) {
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    if (!normalizedQuery.includes(normalizedAlias)) continue;
    matches.push(`${alias.alias} → ${alias.canonicalTerm}`);
    matchedAliases.push(alias);
    for (const term of tokenize(alias.canonicalTerm)) terms.add(term);
  }

  return { terms: [...terms], matches, matchedAliases };
}
