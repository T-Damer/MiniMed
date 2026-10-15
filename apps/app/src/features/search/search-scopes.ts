/**
 * Every search scope: one list for the type, the saved history and the saved preferences. Kept free
 * of imports so start-up state code can validate a stored scope without loading the search core.
 */
export const SEARCH_SCOPES = [
  'diagnosis',
  'guidelines',
  'medications',
  'legal',
  'all',
  'personal',
  'conditions',
  'icd11',
  'calculators',
  'assessments',
] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number];

export function isSearchScope(value: unknown): value is SearchScope {
  return SEARCH_SCOPES.some((scope) => scope === value);
}
