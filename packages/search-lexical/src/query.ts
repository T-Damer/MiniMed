import type { SearchSuggestion } from '@localmed/contracts';
import type { AliasRecord } from '@localmed/domain';

import type { LexicalQueryBranchPlan } from './analysis';
import { analyzeClinicalQuery } from './clinical-query';

export interface LexicalQueryPlan {
  readonly originalQuery: string;
  readonly normalizedQuery: string;
  readonly ftsQuery: string;
  readonly terms: readonly string[];
  readonly aliasMatches: readonly string[];
  readonly suggestions: readonly SearchSuggestion[];
  readonly branches: readonly LexicalQueryBranchPlan[];
}

export function buildLexicalQueryPlan(
  query: string,
  aliases: readonly AliasRecord[],
): LexicalQueryPlan {
  const plan = analyzeClinicalQuery(query, aliases, true);
  return {
    originalQuery: query,
    normalizedQuery: plan.analysis.normalizedQuery,
    ftsQuery: plan.ftsQuery,
    terms: plan.terms,
    aliasMatches: plan.aliasMatches,
    suggestions: plan.analysis.suggestions,
    branches: plan.branches,
  };
}
