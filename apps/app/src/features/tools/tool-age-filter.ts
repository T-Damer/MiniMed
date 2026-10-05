import type { ToolAgeGroup, ToolAgeScope } from '@localmed/contracts';

/** The «Дети / Взрослые / Все» choice shown wherever tools are listed. */
export type ToolAgeFilter = 'children' | 'adults' | 'all';

export const TOOL_AGE_FILTERS: readonly {
  readonly id: ToolAgeFilter;
  readonly label: string;
}[] = [
  { id: 'children', label: 'Дети' },
  { id: 'adults', label: 'Взрослые' },
  { id: 'all', label: 'Все' },
];

export const DEFAULT_TOOL_AGE_FILTER: ToolAgeFilter = 'all';

export function isToolAgeFilter(value: unknown): value is ToolAgeFilter {
  return value === 'children' || value === 'adults' || value === 'all';
}

/** Anything with an age scope: a catalog entry, a definition, an app tool. */
export interface AgeScoped {
  readonly ageScope: ToolAgeScope;
}

function covers(scope: ToolAgeScope, group: ToolAgeGroup): boolean {
  return scope.groups.includes(group);
}

/** A newborn is also a child, so «Дети» keeps tools declared for the newborn period. */
export function toolMatchesAgeFilter(scope: ToolAgeScope, filter: ToolAgeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'adults') return covers(scope, 'adults');
  return covers(scope, 'children') || covers(scope, 'neonates');
}

export function filterByAge<T extends AgeScoped>(
  tools: readonly T[],
  filter: ToolAgeFilter,
): readonly T[] {
  return filter === 'all'
    ? tools
    : tools.filter((tool) => toolMatchesAgeFilter(tool.ageScope, filter));
}
