import type { EpidemicRow } from '@/features/vaccination/vaccination-calendar';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

/** Rows of Appendix 2 for a text over the vaccine and the categories; an empty text keeps all. */
export function filterEpidemicRows(
  rows: readonly EpidemicRow[],
  query: string,
): readonly EpidemicRow[] {
  return rows.filter((row) =>
    matchesFuzzyQuery(query, [row.vaccine, ...row.categories.map((block) => block.text)]),
  );
}
