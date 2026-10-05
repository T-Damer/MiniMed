import {
  type ToolAgeBound,
  type ToolAgeGroup,
  type ToolAgeScope,
  toolAgeBoundEndDays,
  toolAgeBoundStartDays,
} from '@localmed/contracts';
import type { ToolAgeFilter } from '@/features/tools/tool-age-filter';
import { pluralRu } from '@/i18n/labels';

function covers(scope: ToolAgeScope, group: ToolAgeGroup): boolean {
  return scope.groups.includes(group);
}

/** True when the source says age does not matter: every group is declared. */
export function isAnyAge(scope: ToolAgeScope): boolean {
  return covers(scope, 'neonates') && covers(scope, 'children') && covers(scope, 'adults');
}

/** The limit after «от» or «до» (genitive): «от 1 года», «до 16 лет», «до 30 дней». */
export function formatToolAgeBound(bound: ToolAgeBound): string {
  switch (bound.unit) {
    case 'days':
      return `${bound.value} ${pluralRu(bound.value, 'дня', 'дней', 'дней')}`;
    case 'months':
      return `${bound.value} мес.`;
    case 'years':
      return `${bound.value} ${pluralRu(bound.value, 'года', 'лет', 'лет')}`;
  }
}

function rangeText(scope: ToolAgeScope, hideAdultStart: boolean): string {
  const { minAge, maxAge } = scope;
  const showMin = minAge && !(hideAdultStart && minAge.unit === 'years' && minAge.value === 18);
  if (showMin && maxAge) {
    // «1–16 лет» when both limits use one unit, «от 1 мес. до 17 лет» otherwise.
    return minAge.unit === maxAge.unit
      ? `${minAge.value}–${formatToolAgeBound(maxAge)}`
      : `от ${formatToolAgeBound(minAge)} до ${formatToolAgeBound(maxAge)}`;
  }
  if (showMin && minAge) return `от ${formatToolAgeBound(minAge)}`;
  if (maxAge) return `до ${formatToolAgeBound(maxAge)}`;
  return '';
}

export type ToolAgeBadgeTone = 'any' | 'children' | 'adults' | 'both' | 'neonates';

export interface ToolAgeBadge {
  readonly label: string;
  readonly tone: ToolAgeBadgeTone;
}

/** Short wording for a tool card: «Дети 1–16 лет», «Взрослые», «Новорождённые», «Любой возраст». */
export function toolAgeBadge(scope: ToolAgeScope): ToolAgeBadge {
  if (isAnyAge(scope)) return { label: 'Любой возраст', tone: 'any' };
  const adults = covers(scope, 'adults');
  const children = covers(scope, 'children');
  const neonates = covers(scope, 'neonates');
  if (adults && !children && !neonates) {
    const range = rangeText(scope, true);
    return { label: range ? `Взрослые ${range}` : 'Взрослые', tone: 'adults' };
  }
  if (adults) {
    const range = rangeText(scope, false);
    return { label: range ? `Дети и взрослые ${range}` : 'Дети и взрослые', tone: 'both' };
  }
  if (!children) {
    const range = rangeText(scope, false);
    return { label: range ? `Новорождённые ${range}` : 'Новорождённые', tone: 'neonates' };
  }
  const range = rangeText(scope, false);
  if (neonates && !scope.minAge) {
    return {
      label: range ? `Дети от рождения ${range}` : 'Дети, включая новорождённых',
      tone: 'children',
    };
  }
  return { label: range ? `Дети ${range}` : 'Дети', tone: 'children' };
}

/** The group a patient of this age belongs to; a newborn is a child for the filter. */
export function ageGroupForAgeDays(ageDays: number): ToolAgeGroup {
  if (ageDays < 31) return 'neonates';
  return ageDays < 18 * 365.25 ? 'children' : 'adults';
}

/** The list filter that fits a patient of this age («Дети» for a child, «Взрослые» otherwise). */
export function ageFilterForAgeDays(ageDays: number): Exclude<ToolAgeFilter, 'all'> {
  return ageGroupForAgeDays(ageDays) === 'adults' ? 'adults' : 'children';
}

/** Whether a patient of this age is inside the tool's declared groups and limits. */
export function ageScopeAcceptsAgeDays(scope: ToolAgeScope, ageDays: number): boolean {
  const group = ageGroupForAgeDays(ageDays);
  // A newborn is a child: a tool for children is not flagged as wrong for the newborn month.
  const groupFits = covers(scope, group) || (group === 'neonates' && covers(scope, 'children'));
  if (!groupFits) return false;
  if (scope.minAge && ageDays < toolAgeBoundStartDays(scope.minAge)) return false;
  if (scope.maxAge && ageDays > toolAgeBoundEndDays(scope.maxAge)) return false;
  return true;
}

/** Completed days between a birth date and a date (both YYYY-MM-DD); undefined for bad input. */
export function ageDaysBetween(birthDate: string, onDate: string): number | undefined {
  const birth = Date.parse(`${birthDate.slice(0, 10)}T00:00:00Z`);
  const date = Date.parse(`${onDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(birth) || Number.isNaN(date) || date < birth) return undefined;
  return Math.floor((date - birth) / 86_400_000);
}
