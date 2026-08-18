import { matchesFuzzyQuery } from '@/state/fuzzy-text';

export function matchesCatalogQuery(query: string, values: readonly string[]): boolean {
  return matchesFuzzyQuery(query, values);
}
