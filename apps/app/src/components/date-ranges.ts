/**
 * Pure logic for «which days» selections: sorted, non-overlapping, non-adjacent ranges of local
 * calendar days. Days are `YYYY-MM-DD` keys; arithmetic goes through UTC day numbers so daylight
 * saving never shifts a day.
 */

export interface DayRange {
  readonly from: string;
  readonly to: string;
}

const MS_PER_DAY = 86_400_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/u;

const MONTHS_SHORT = [
  'янв.',
  'февр.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
] as const;

/** The number of a day (days since 1970-01-01), or `NaN` for a malformed or impossible key. */
export function dayNumber(day: string): number {
  const match = DAY_KEY.exec(day);
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const time = Date.UTC(year, month - 1, date);
  const check = new Date(time);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    return Number.NaN;
  }
  return time / MS_PER_DAY;
}

/** The key of day number `n`. */
export function dayFromNumber(n: number): string {
  const date = new Date(n * MS_PER_DAY);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDayKey(value: string): boolean {
  return !Number.isNaN(dayNumber(value));
}

/** The key `count` days after `day` (negative counts go back). */
export function addDays(day: string, count: number): string {
  return dayFromNumber(dayNumber(day) + count);
}

/** The local calendar day of a moment, by default now. */
export function localDayKey(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Orders the ends of a range; malformed keys yield `undefined`. */
function orderedRange(a: string, b: string): DayRange | undefined {
  const na = dayNumber(a);
  const nb = dayNumber(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return undefined;
  return na <= nb ? { from: a, to: b } : { from: b, to: a };
}

/** Sorts, drops malformed ranges and merges overlapping or adjacent ones. */
export function normalizeRanges(ranges: readonly DayRange[]): DayRange[] {
  const ordered: DayRange[] = [];
  for (const range of ranges) {
    const next = orderedRange(range.from, range.to);
    if (next) ordered.push(next);
  }
  ordered.sort((a, b) => dayNumber(a.from) - dayNumber(b.from));
  const merged: DayRange[] = [];
  for (const range of ordered) {
    const last = merged[merged.length - 1];
    if (last && dayNumber(range.from) <= dayNumber(last.to) + 1) {
      if (dayNumber(range.to) > dayNumber(last.to))
        merged[merged.length - 1] = { from: last.from, to: range.to };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export function rangesContain(ranges: readonly DayRange[], day: string): boolean {
  const n = dayNumber(day);
  if (Number.isNaN(n)) return false;
  return ranges.some((range) => dayNumber(range.from) <= n && n <= dayNumber(range.to));
}

/** The number of distinct days covered. */
export function countDays(ranges: readonly DayRange[]): number {
  let total = 0;
  for (const range of normalizeRanges(ranges)) {
    total += dayNumber(range.to) - dayNumber(range.from) + 1;
  }
  return total;
}

/** Adds the days between two taps (in either order, ends included). */
export function addRange(ranges: readonly DayRange[], a: string, b: string): DayRange[] {
  const range = orderedRange(a, b);
  return normalizeRanges(range ? [...ranges, range] : ranges);
}

/** Adds one day. */
export function addDay(ranges: readonly DayRange[], day: string): DayRange[] {
  return addRange(ranges, day, day);
}

/** Removes one day; a day inside a range splits it in two. */
export function removeDay(ranges: readonly DayRange[], day: string): DayRange[] {
  const n = dayNumber(day);
  if (Number.isNaN(n)) return normalizeRanges(ranges);
  const next: DayRange[] = [];
  for (const range of normalizeRanges(ranges)) {
    const from = dayNumber(range.from);
    const to = dayNumber(range.to);
    if (n < from || n > to) {
      next.push(range);
      continue;
    }
    if (from < n) next.push({ from: range.from, to: dayFromNumber(n - 1) });
    if (n < to) next.push({ from: dayFromNumber(n + 1), to: range.to });
  }
  return next;
}

/** Selects a free day or deselects a selected one. */
export function toggleDay(ranges: readonly DayRange[], day: string): DayRange[] {
  return rangesContain(ranges, day) ? removeDay(ranges, day) : addDay(ranges, day);
}

/** `days` days counting `start` as the first: a 7-day course from the 27th ends on the 2nd. */
export function presetRange(start: string, days: number): DayRange[] {
  if (!isDayKey(start) || !Number.isFinite(days) || days < 1) return [];
  return [{ from: start, to: addDays(start, Math.floor(days) - 1) }];
}

/** Russian «день / дня / дней» for a count. */
export function pluralDays(count: number): string {
  const abs = Math.abs(count);
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}

/** «27 окт.», with the year when asked. */
export function shortDay(day: string, withYear: boolean): string {
  const [year = '', month = '1', date = '1'] = day.split('-');
  const label = `${Number(date)} ${MONTHS_SHORT[Number(month) - 1] ?? ''}`;
  return withYear ? `${label} ${Number(year)}` : label;
}

/**
 * «27 окт. – 9 нояб. · 14 дней» («3 – 9 нояб.» inside one month); several ranges are joined with commas and one total follows.
 * A range that crosses a year boundary names both years. No ranges: «Без срока».
 */
export function describeRanges(ranges: readonly DayRange[]): string {
  const normal = normalizeRanges(ranges);
  if (normal.length === 0) return 'Без срока';
  const parts = normal.map((range) => {
    if (range.from === range.to) return shortDay(range.from, false);
    if (range.from.slice(0, 7) === range.to.slice(0, 7)) {
      return `${Number(range.from.slice(8))} – ${shortDay(range.to, false)}`;
    }
    const crossesYear = range.from.slice(0, 4) !== range.to.slice(0, 4);
    return `${shortDay(range.from, crossesYear)} – ${shortDay(range.to, crossesYear)}`;
  });
  const total = countDays(normal);
  return `${parts.join(', ')} · ${total} ${pluralDays(total)}`;
}
