import type { ToolAgeScope } from '@localmed/contracts';
import { anyAgeScope } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  filterByAge,
  isToolAgeFilter,
  TOOL_AGE_FILTERS,
  toolMatchesAgeFilter,
} from '@/features/tools/tool-age-filter';
import {
  ageDaysBetween,
  ageFilterForAgeDays,
  ageGroupForAgeDays,
  ageScopeAcceptsAgeDays,
  isAnyAge,
  toolAgeBadge,
} from '@/features/tools/tool-age-scope';

const scope = (value: Omit<ToolAgeScope, 'basis'>): ToolAgeScope => ({ ...value, basis: 'Тест' });

const adults = scope({ groups: ['adults'] });
const children = scope({
  groups: ['children'],
  minAge: { value: 1, unit: 'years' },
  maxAge: { value: 16, unit: 'years' },
});
const newborns = scope({ groups: ['neonates'] });
const both = scope({ groups: ['children', 'adults'] });
const everyone = anyAgeScope('Тест');

describe('tool age filter', () => {
  it('lists Дети, Взрослые and Все in that order', () => {
    expect(TOOL_AGE_FILTERS.map((entry) => entry.label)).toEqual(['Дети', 'Взрослые', 'Все']);
    expect(isToolAgeFilter('children')).toBe(true);
    expect(isToolAgeFilter('teens')).toBe(false);
  });

  it('keeps every tool under «Все»', () => {
    for (const entry of [adults, children, newborns, both, everyone]) {
      expect(toolMatchesAgeFilter(entry, 'all')).toBe(true);
    }
  });

  it('shows children, newborn and any-age tools under «Дети» and never adult-only ones', () => {
    expect(toolMatchesAgeFilter(children, 'children')).toBe(true);
    expect(toolMatchesAgeFilter(newborns, 'children')).toBe(true);
    expect(toolMatchesAgeFilter(both, 'children')).toBe(true);
    expect(toolMatchesAgeFilter(everyone, 'children')).toBe(true);
    expect(toolMatchesAgeFilter(adults, 'children')).toBe(false);
  });

  it('shows adult, mixed and any-age tools under «Взрослые» and never child-only ones', () => {
    expect(toolMatchesAgeFilter(adults, 'adults')).toBe(true);
    expect(toolMatchesAgeFilter(both, 'adults')).toBe(true);
    expect(toolMatchesAgeFilter(everyone, 'adults')).toBe(true);
    expect(toolMatchesAgeFilter(children, 'adults')).toBe(false);
    expect(toolMatchesAgeFilter(newborns, 'adults')).toBe(false);
  });

  it('filters a list and keeps the order', () => {
    const tools = [
      { id: 'a', ageScope: adults },
      { id: 'c', ageScope: children },
      { id: 'b', ageScope: both },
    ];
    expect(filterByAge(tools, 'children').map((tool) => tool.id)).toEqual(['c', 'b']);
    expect(filterByAge(tools, 'adults').map((tool) => tool.id)).toEqual(['a', 'b']);
    expect(filterByAge(tools, 'all')).toBe(tools);
  });
});

describe('tool age badge', () => {
  it('names the group and the range the source gives', () => {
    expect(toolAgeBadge(adults)).toEqual({ label: 'Взрослые', tone: 'adults' });
    expect(toolAgeBadge(children)).toEqual({ label: 'Дети 1–16 лет', tone: 'children' });
    expect(toolAgeBadge(newborns)).toEqual({ label: 'Новорождённые', tone: 'neonates' });
    expect(toolAgeBadge(both)).toEqual({ label: 'Дети и взрослые', tone: 'both' });
    expect(toolAgeBadge(everyone)).toEqual({ label: 'Любой возраст', tone: 'any' });
  });

  it('shows limits in the unit the source used', () => {
    expect(
      toolAgeBadge(
        scope({
          groups: ['children'],
          minAge: { value: 2, unit: 'months' },
          maxAge: { value: 7, unit: 'years' },
        }),
      ).label,
    ).toBe('Дети от 2 мес. до 7 лет');
    expect(
      toolAgeBadge(
        scope({ groups: ['neonates', 'children'], maxAge: { value: 35, unit: 'months' } }),
      ).label,
    ).toBe('Дети от рождения до 35 мес.');
    expect(toolAgeBadge(scope({ groups: ['neonates', 'children'] })).label).toBe(
      'Дети, включая новорождённых',
    );
    expect(
      toolAgeBadge(
        scope({
          groups: ['adults'],
          minAge: { value: 20, unit: 'years' },
          maxAge: { value: 89, unit: 'years' },
        }),
      ).label,
    ).toBe('Взрослые 20–89 лет');
    expect(
      toolAgeBadge(scope({ groups: ['adults'], minAge: { value: 18, unit: 'years' } })).label,
    ).toBe('Взрослые');
    expect(
      toolAgeBadge(scope({ groups: ['children', 'adults'], minAge: { value: 4, unit: 'years' } }))
        .label,
    ).toBe('Дети и взрослые от 4 лет');
    expect(
      toolAgeBadge(scope({ groups: ['neonates'], maxAge: { value: 30, unit: 'days' } })).label,
    ).toBe('Новорождённые до 30 дней');
  });

  it('knows which scopes mean any age', () => {
    expect(isAnyAge(everyone)).toBe(true);
    expect(isAnyAge(both)).toBe(false);
  });
});

describe('patient age and tool scope', () => {
  it('sorts a patient into newborn, child or adult and picks the matching filter', () => {
    expect(ageGroupForAgeDays(10)).toBe('neonates');
    expect(ageGroupForAgeDays(200)).toBe('children');
    expect(ageGroupForAgeDays(18 * 366)).toBe('adults');
    expect(ageFilterForAgeDays(10)).toBe('children');
    expect(ageFilterForAgeDays(18 * 366)).toBe('adults');
  });

  it('accepts a patient only inside the declared groups and limits', () => {
    expect(ageScopeAcceptsAgeDays(adults, 40 * 366)).toBe(true);
    expect(ageScopeAcceptsAgeDays(adults, 5 * 366)).toBe(false);
    expect(ageScopeAcceptsAgeDays(children, 8 * 366)).toBe(true);
    // Schwartz-like «1–16 лет»: a 6-month-old and a 17-year-old are outside.
    expect(ageScopeAcceptsAgeDays(children, 180)).toBe(false);
    expect(ageScopeAcceptsAgeDays(children, 17 * 366)).toBe(false);
    expect(ageScopeAcceptsAgeDays(children, 16 * 365 + 300)).toBe(true);
    expect(ageScopeAcceptsAgeDays(everyone, 0)).toBe(true);
    expect(ageScopeAcceptsAgeDays(newborns, 10)).toBe(true);
    expect(ageScopeAcceptsAgeDays(newborns, 90)).toBe(false);
  });

  it('counts completed days between a birth date and a date', () => {
    expect(ageDaysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(ageDaysBetween('2026-02-01', '2026-01-01')).toBeUndefined();
    expect(ageDaysBetween('nonsense', '2026-01-01')).toBeUndefined();
  });
});
