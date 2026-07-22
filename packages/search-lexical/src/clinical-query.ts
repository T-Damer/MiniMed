import type { QueryBranch } from '@localmed/contracts';
import type { AliasRecord } from '@localmed/domain';

import {
  analyzeClinicalQuery as analyzeClinicalQueryRaw,
  type ClinicalQueryPlan,
  type LexicalQueryBranchPlan,
} from './analysis';
import { lightStemRussian, normalizeSurfaceText, tokenize } from './normalize';

function medicationTerms(plan: ClinicalQueryPlan): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const fact of plan.analysis.facts) {
    if (fact.kind !== 'medication') continue;
    for (const value of [fact.value, fact.normalizedValue]) {
      for (const token of tokenize(value)) {
        terms.add(token);
        terms.add(lightStemRussian(token));
      }
    }
  }
  return terms;
}

function ftsToken(term: string): string {
  return `"${term.replaceAll('"', '""')}"*`;
}

function publicBranch(branch: LexicalQueryBranchPlan): QueryBranch {
  const { ftsQuery: _ftsQuery, ...value } = branch;
  return value;
}

function symptomBranch(plan: ClinicalQueryPlan): LexicalQueryBranchPlan | null {
  const values = plan.analysis.facts
    .filter((fact) => fact.kind === 'symptom' && fact.polarity === 'positive')
    .map((fact) => fact.normalizedValue);
  const terms = new Set<string>();
  for (const value of values) {
    for (const token of tokenize(value)) {
      if (token.length < 2) continue;
      terms.add(token);
      terms.add(lightStemRussian(token));
    }
  }
  if (terms.size === 0) return null;
  const orderedTerms = [...terms];
  const query = values.join(' ');
  return {
    id: 'canonical-symptoms',
    kind: 'clinical',
    label: 'Распознанные симптомы',
    query,
    normalizedQuery: normalizeSurfaceText(query),
    terms: orderedTerms,
    weight: 1.58,
    ftsQuery: orderedTerms.map(ftsToken).join(' OR '),
  };
}

function sanitizeDiagnosticBranches(plan: ClinicalQueryPlan): readonly LexicalQueryBranchPlan[] {
  const excluded = medicationTerms(plan);
  if (excluded.size === 0) return plan.branches;

  return plan.branches.flatMap((branch): LexicalQueryBranchPlan[] => {
    if (branch.kind === 'medication' || branch.id === 'medications') return [];
    if (
      branch.kind === 'clause' &&
      /(?:принимает|получает|назначен[а-я]*|терапия)/u.test(branch.normalizedQuery)
    ) {
      return [];
    }
    const terms = branch.terms.filter((term) => !excluded.has(term));
    if (terms.length === 0) return [];
    return [
      {
        ...branch,
        terms,
        ftsQuery: terms.map(ftsToken).join(' OR '),
      },
    ];
  });
}

export function analyzeClinicalQuery(
  query: string,
  aliases: readonly AliasRecord[],
  includeSuggestions = true,
): ClinicalQueryPlan {
  const plan = analyzeClinicalQueryRaw(query, aliases, includeSuggestions);
  if (plan.analysis.intent?.primary !== 'diagnosis') return plan;

  const sanitized = sanitizeDiagnosticBranches(plan);
  const canonicalSymptoms = symptomBranch(plan);
  const branches = canonicalSymptoms
    ? [
        canonicalSymptoms,
        ...sanitized.filter((branch) => branch.ftsQuery !== canonicalSymptoms.ftsQuery),
      ]
    : sanitized;
  if (branches.length === 0) return plan;
  const terms = [...new Set(branches.flatMap((branch) => branch.terms))];
  return {
    ...plan,
    analysis: plan.analysis,
    branches,
    terms,
    ftsQuery: branches[0]?.ftsQuery ?? '',
  };
}
