import type { NationalRow } from '@/features/vaccination/vaccination-calendar';

/**
 * Dates for the age rows of the national calendar, counted from a birth date. They are calculated
 * from the ages the order prints: the order names no dates, no minimum intervals and no catch-up
 * schedule, and the plan knows nothing about vaccinations already given or contraindications.
 */

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ADULT_AGE_MONTHS = 18 * 12;
const MS_PER_DAY = 86_400_000;

export function parseIsoDate(value: string): CalendarDate | undefined {
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { year, month, day };
}

export function formatIsoDate(date: CalendarDate): string {
  const pad = (value: number, length: number): string => String(value).padStart(length, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

function toUtc(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function fromUtc(time: number): CalendarDate {
  const value = new Date(time);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromUtc(toUtc(date) + days * MS_PER_DAY);
}

/** Calendar months later; a day that does not exist there (31 → 30, 29 Feb) becomes the last day. */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(date.day, lastDay) };
}

/** `4,5` months is four calendar months and fifteen days; whole months are calendar months. */
export function addAgeMonths(date: CalendarDate, months: number): CalendarDate {
  const whole = Math.floor(months);
  const shifted = addMonths(date, whole);
  const fraction = months - whole;
  return fraction === 0 ? shifted : addDays(shifted, Math.round(fraction * 30));
}

export function compareDates(left: CalendarDate, right: CalendarDate): number {
  return toUtc(left) - toUtc(right);
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

export type PlanStatus = 'passed' | 'current' | 'upcoming';

export interface PlanEntry {
  readonly rowId: string;
  readonly number: string;
  readonly ageLabel: string;
  /** First date the child has the age of the row. */
  readonly from: CalendarDate;
  /** Last date of a window the order names (3–7 days, 6–7 years); equals `from` for a point age. */
  readonly to: CalendarDate;
  /** True when the date rests on a convention (half months, days of life) the order does not fix. */
  readonly approximate: boolean;
  readonly status: PlanStatus;
}

export type PlanProblem = 'invalid-date' | 'future-date' | 'adult';

export type ChildPlan =
  | { readonly kind: 'plan'; readonly entries: readonly PlanEntry[] }
  | { readonly kind: 'problem'; readonly problem: PlanProblem };

export const PLAN_PROBLEM_MESSAGES: Readonly<Record<PlanProblem, string>> = {
  'invalid-date': 'Введите дату рождения в формате день.месяц.год.',
  'future-date': 'Дата рождения не может быть позже сегодняшнего дня.',
  adult: 'План рассчитывается для детей до 18 лет.',
};

/**
 * Dates of one age row. Days of life count the day of birth as day 1, so «3–7 день» is the third to
 * the seventh day after the birth date inclusive of the first; that convention is noted on screen.
 */
function entryDates(
  row: NationalRow,
  birth: CalendarDate,
): { from: CalendarDate; to: CalendarDate; approximate: boolean } | undefined {
  if (row.age === null) return undefined;
  const { unit, from, to } = row.age;
  if (unit === 'day-of-life') {
    return { from: addDays(birth, from - 1), to: addDays(birth, to - 1), approximate: from !== to };
  }
  return {
    from: addAgeMonths(birth, from),
    to: addAgeMonths(birth, to),
    approximate: !Number.isInteger(from) || from !== to,
  };
}

/**
 * Plan for the age rows of Appendix 1. The status marks where `today` falls among the rows:
 * rows whose age has passed, the latest age reached, and the ones still ahead. It says nothing
 * about whether a vaccination was given.
 */
export function buildChildPlan(
  rows: readonly NationalRow[],
  birthDate: string,
  today: string,
): ChildPlan {
  const birth = parseIsoDate(birthDate);
  const now = parseIsoDate(today);
  if (!birth || !now) return { kind: 'problem', problem: 'invalid-date' };
  if (compareDates(birth, now) > 0) return { kind: 'problem', problem: 'future-date' };
  if (compareDates(addMonths(birth, ADULT_AGE_MONTHS), now) <= 0) {
    return { kind: 'problem', problem: 'adult' };
  }
  const dated = rows.flatMap((row) => {
    const dates = entryDates(row, birth);
    return dates ? [{ row, ...dates }] : [];
  });
  const reached = dated.filter((entry) => compareDates(entry.from, now) <= 0);
  const current = reached[reached.length - 1]?.row.id;
  const entries = dated.map((entry): PlanEntry => {
    const status: PlanStatus =
      entry.row.id === current
        ? 'current'
        : compareDates(entry.from, now) < 0
          ? 'passed'
          : 'upcoming';
    return {
      rowId: entry.row.id,
      number: entry.row.number,
      ageLabel: entry.row.ageLabel,
      from: entry.from,
      to: entry.to,
      approximate: entry.approximate,
      status,
    };
  });
  return { kind: 'plan', entries };
}
