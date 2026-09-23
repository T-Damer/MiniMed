import type { AliasRecord } from '@localmed/domain';
import type { AliasExpansion } from './aliases';
import { buildLookupQueryPlan as originalLookup, type ClinicalQueryPlan } from './analysis';
import { createMedicationSpellingMatcher } from './medication-spelling';

// The key is the immutable vocabulary supplied by the current core, not a query or a global edition.
// Reinitialization replaces that array; old indexes are collectible with their vocabulary.
const matchers = new WeakMap<readonly AliasRecord[], ReturnType<typeof createMedicationSpellingMatcher>>();

/** Source lookup adds labelled alternatives; clinical facts/calculators keep the original parser. */
export function buildLookupQueryPlan(
  query: string,
  aliases: readonly AliasRecord[],
  preparedExpansion?: AliasExpansion,
): ClinicalQueryPlan {
  const original = originalLookup(query, aliases, preparedExpansion);
  let match = matchers.get(aliases);
  if (!match) {
    match = createMedicationSpellingMatcher(aliases);
    matchers.set(aliases, match);
  }
  const candidates = match(query);
  if (!candidates.length) return original;
  const branches = [...original.branches];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    // Reuse the existing quoted/stemmed query builder; never concatenate user text into SQL.
    const corrected = originalLookup(candidate.replacementQuery, [], {
      terms: candidate.canonicalTerms,
      matches: [],
      matchedAliases: [],
      matchSpans: [],
    });
    const branch = corrected.branches[0];
    if (!branch || seen.has(branch.ftsQuery)) continue;
    seen.add(branch.ftsQuery);
    branches.push({
      ...branch,
      id: `medication-spelling-${seen.size}`,
      kind: 'medication',
      label: `Возможная опечатка: ${candidate.name}`,
      weight: 0.95 - candidate.cost * 0.02,
    });
  }
  const terms = [...new Set(branches.flatMap((branch) => branch.terms))];
  return {
    ...original,
    branches,
    terms,
    ftsQuery: branches.map((branch) => branch.ftsQuery).join(' || '),
    aliasMatches: [
      ...original.aliasMatches,
      ...candidates.map((candidate) => `${candidate.matchedText} → ${candidate.name} (возможная опечатка)`),
    ],
    analysis: {
      ...original.analysis,
      branches,
      warnings: [
        ...original.analysis.warnings,
        `Возможная опечатка в названии препарата. Варианты поиска: ${candidates.map((candidate) => candidate.name).join('; ')}. Проверьте название: это не рекомендация заменить препарат.`,
      ],
    },
  };
}
