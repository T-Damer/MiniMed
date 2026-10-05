import {
  type EpidemicRow,
  isAgeRow,
  type NationalRow,
  type VaccinationPopulation,
} from '@/features/vaccination/vaccination-calendar';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

export type CalendarPart = 'national' | 'epidemic';
export type PopulationFilter = 'all' | 'children' | 'adults';

export interface CalendarFilter {
  readonly part: CalendarPart;
  readonly population: PopulationFilter;
  /** `any`, or the id of an age row of the national calendar. */
  readonly age: string;
  /** Free text over the epidemic-indications rows. */
  readonly query: string;
}

export const DEFAULT_FILTER: CalendarFilter = {
  part: 'national',
  population: 'all',
  age: 'any',
  query: '',
};

function populationMatches(row: VaccinationPopulation, filter: PopulationFilter): boolean {
  return filter === 'all' || row === 'both' || row === filter;
}

/**
 * Rows of Appendix 1 for a filter. An age keeps its row and every category row: the categories
 * (rows 16–19) are conditions the order does not tie to one age, so a filter never hides them.
 */
export function filterNationalRows(
  rows: readonly NationalRow[],
  filter: CalendarFilter,
): readonly NationalRow[] {
  return rows.filter((row) => {
    if (!populationMatches(row.population, filter.population)) return false;
    if (filter.age === 'any') return true;
    return !isAgeRow(row) || row.id === filter.age;
  });
}

/** Rows of Appendix 2 for a filter: population and a text over the vaccine and the categories. */
export function filterEpidemicRows(
  rows: readonly EpidemicRow[],
  filter: CalendarFilter,
): readonly EpidemicRow[] {
  return rows.filter(
    (row) =>
      populationMatches(row.population, filter.population) &&
      matchesFuzzyQuery(filter.query, [row.vaccine, ...row.categories.map((block) => block.text)]),
  );
}
