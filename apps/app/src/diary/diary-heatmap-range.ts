/** Pure range, title and part-filter logic of the month calendar (no UI imports, unit-tested). */
import { HEAT_PART_LABEL, type HeatPart } from '@/features/diary/diary-care';

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

/** The longest history the calendar shows, in whole months (the current one included). */
export const HEATMAP_MAX_MONTHS = 12;

export interface HeatmapRange {
  /** First day of the earliest month shown. */
  readonly from: string;
  /** Last day of the current month, possibly after today. */
  readonly to: string;
  /** `YYYY-MM` of every month shown, oldest first. */
  readonly months: readonly string[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The month `count` months from a `YYYY-MM` key. */
export function shiftMonth(month: string, count: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (number - 1) + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function monthEnd(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return `${month}-${pad(new Date(year, number, 0).getDate())}`;
}

/**
 * Days the calendar shows: the current month in full (days after today are dimmed by the grid),
 * plus every earlier whole month back to the month the diary started; at most twelve months.
 */
export function heatmapRange(started: string, today: string): HeatmapRange {
  const current = today.slice(0, 7);
  const oldest = shiftMonth(current, 1 - HEATMAP_MAX_MONTHS);
  const first = started > today ? current : started.slice(0, 7);
  const start = first < oldest ? oldest : first;
  const months: string[] = [];
  for (let month = start; month <= current; month = shiftMonth(month, 1)) months.push(month);
  return { from: `${start}-01`, to: monthEnd(current), months };
}

function monthName(key: string): string {
  const [year, number] = key.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[number - 1] ?? ''} ${year}`;
}

/** «Октябрь 2026», or «Ноябрь 2025 — октябрь 2026». */
export function heatTitle(first: string, last: string): string {
  if (first === last) return monthName(first);
  const end = monthName(last);
  return `${monthName(first)} — ${end.charAt(0).toLowerCase()}${end.slice(1)}`;
}

/** The chosen parts that this diary has; nothing chosen (or nothing left) means all of them. */
export function activeHeatParts(
  parts: readonly HeatPart[],
  include: ReadonlySet<HeatPart>,
): readonly HeatPart[] {
  const chosen = parts.filter((part) => include.has(part));
  return chosen.length > 0 ? chosen : parts;
}

/** Short state of the filter for its button: «Всё», the one part chosen, or «3 из 5». */
export function heatFilterSummary(
  parts: readonly HeatPart[],
  include: ReadonlySet<HeatPart>,
): string {
  const chosen = activeHeatParts(parts, include);
  if (chosen.length === parts.length) return 'Всё';
  const [only] = chosen;
  return chosen.length === 1 && only
    ? HEAT_PART_LABEL[only]
    : `${chosen.length} из ${parts.length}`;
}

/** The set after a part was switched; the last part that is on cannot be switched off. */
export function toggleHeatPart(
  parts: readonly HeatPart[],
  include: ReadonlySet<HeatPart>,
  part: HeatPart,
): ReadonlySet<HeatPart> {
  const chosen = new Set(activeHeatParts(parts, include));
  if (!chosen.has(part)) chosen.add(part);
  else if (chosen.size > 1) chosen.delete(part);
  return chosen;
}
