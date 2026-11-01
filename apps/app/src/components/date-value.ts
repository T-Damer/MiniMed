/**
 * Calendar days as `YYYY-MM-DD` strings (the value of every date field, like the old native
 * inputs) and their Russian display «ДД.ММ.ГГГГ». Pure: no Date in local time zones beyond
 * building a day's weekday, so a day never shifts by a time zone.
 */

export interface DayParts {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  readonly day: number;
}

export const MONTHS_NOMINATIVE = [
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
] as const;

export const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidDay(parts: DayParts): boolean {
  return (
    Number.isInteger(parts.year) &&
    parts.year >= 1000 &&
    parts.year <= 9999 &&
    parts.month >= 1 &&
    parts.month <= 12 &&
    parts.day >= 1 &&
    parts.day <= daysInMonth(parts.year, parts.month)
  );
}

/** `YYYY-MM-DD` → parts, or undefined for anything else (an empty or partial value). */
export function parseDayValue(value: string): DayParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return isValidDay(parts) ? parts : undefined;
}

export function formatDayValue(parts: DayParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** `YYYY-MM-DD` → «ДД.ММ.ГГГГ»; '' for an empty or invalid value. */
export function displayDay(value: string): string {
  const parts = parseDayValue(value);
  return parts ? `${pad(parts.day)}.${pad(parts.month)}.${pad(parts.year, 4)}` : '';
}

/**
 * What the person typed, masked as they type: digits only, dots added after the day and the month
 * («1203» → «12.03», «12032025» → «12.03.2025»). At most eight digits.
 */
export function maskTypedDay(typed: string): string {
  const digits = typed.replaceAll(/\D/gu, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4);
  return [day, month, year].filter((part, index) => part || index === 0).join('.');
}

/**
 * A complete typed «ДД.ММ.ГГГГ» (or 8 digits) → `YYYY-MM-DD`; undefined when incomplete or impossible.
 * A pasted `YYYY-MM-DD` is read as it is.
 */
export function readTypedDay(typed: string): string | undefined {
  const iso = /^\s*(\d{4}-\d{2}-\d{2})\s*$/u.exec(typed);
  if (iso) return parseDayValue(iso[1] as string) ? (iso[1] as string) : undefined;
  const digits = typed.replaceAll(/\D/gu, '');
  if (digits.length !== 8) return undefined;
  const parts = {
    day: Number(digits.slice(0, 2)),
    month: Number(digits.slice(2, 4)),
    year: Number(digits.slice(4)),
  };
  return isValidDay(parts) ? formatDayValue(parts) : undefined;
}

/** Today in the device's time zone as `YYYY-MM-DD`. */
export function todayValue(now: Date = new Date()): string {
  return formatDayValue({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/** Monday-first weekday (0 = Monday) of the first of the month. */
export function firstWeekday(year: number, month: number): number {
  return (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
}

/** The month's grid: leading blanks (null) then the days; whole weeks. */
export function monthGrid(year: number, month: number): (number | null)[] {
  const cells: (number | null)[] = Array.from({ length: firstWeekday(year, month) }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day += 1) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Within [min, max] (either bound optional), comparing `YYYY-MM-DD` strings. */
export function dayInBounds(value: string, min?: string, max?: string): boolean {
  return (!min || value >= min) && (!max || value <= max);
}

/** Moves a day by whole days (keyboard navigation in the grid). */
export function shiftDay(value: string, days: number): string {
  const parts = parseDayValue(value);
  if (!parts) return value;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatDayValue({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** «12 марта 2025» for screen readers and titles. */
export function spokenDay(value: string): string {
  const parts = parseDayValue(value);
  return parts ? `${parts.day} ${MONTHS_GENITIVE[parts.month - 1]} ${parts.year}` : '';
}
