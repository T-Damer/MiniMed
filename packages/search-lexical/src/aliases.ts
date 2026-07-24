import type { AliasRecord } from '@localmed/domain';

import { normalizeSurfaceText, tokenize } from './normalize';

export interface AliasExpansion {
  readonly terms: readonly string[];
  readonly matches: readonly string[];
  readonly matchedAliases: readonly AliasRecord[];
}

export function findNormalizedPhraseIndex(text: string, phrase: string): number {
  if (!phrase) return -1;
  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`(?:^|[^0-9a-zа-я])(${escapedPhrase})(?![0-9a-zа-я])`, 'u').exec(text);
  const matchedPhrase = match?.[1];
  if (!match || !matchedPhrase) return -1;
  return match.index + match[0].length - matchedPhrase.length;
}

export function expandAliases(query: string, aliases: readonly AliasRecord[]): AliasExpansion {
  const normalizedQuery = normalizeSurfaceText(query);
  const terms = new Set<string>();
  const matches: string[] = [];
  const matchedAliases: AliasRecord[] = [];

  for (const alias of aliases.toSorted((left, right) => right.alias.length - left.alias.length)) {
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    if (findNormalizedPhraseIndex(normalizedQuery, normalizedAlias) < 0) continue;
    matches.push(`${alias.alias} → ${alias.canonicalTerm}`);
    matchedAliases.push(alias);
    for (const term of tokenize(alias.canonicalTerm)) terms.add(term);
  }

  return { terms: [...terms], matches, matchedAliases };
}
