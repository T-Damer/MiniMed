export type EcgPatientRoute = 'unknown' | 'pediatric' | 'adult';

export const ECG_PATIENT_AGE_GROUPS = [
  '0–6d',
  '7–30d',
  '1–3mo',
  '3–6mo',
  '6–12mo',
  '1–3y',
  '3–5y',
  '5–8y',
  '8–12y',
  '12–16y',
  '16–17y',
  'adult 18+',
] as const;

export type EcgPatientAgeGroup = (typeof ECG_PATIENT_AGE_GROUPS)[number];

export const ECG_PATIENT_AGE_GROUP_LABELS: Record<EcgPatientAgeGroup, string> = {
  '0–6d': '0–6 дней',
  '7–30d': '7–30 дней',
  '1–3mo': '1–3 месяца',
  '3–6mo': '3–6 месяцев',
  '6–12mo': '6–12 месяцев',
  '1–3y': '1–3 года',
  '3–5y': '3–5 лет',
  '5–8y': '5–8 лет',
  '8–12y': '8–12 лет',
  '12–16y': '12–16 лет',
  '16–17y': '16–17 лет',
  'adult 18+': '18 лет и старше',
};

export type EcgPatientAgeValidation =
  | 'missing-date'
  | 'invalid-date'
  | 'before-birth'
  | 'over-120-years';

export interface EcgPatientAgeInput {
  readonly dateOfBirth: string;
  readonly ecgDate: string;
}

export interface EcgUnknownPatientAge {
  readonly ageDays?: never;
  readonly ageYears?: never;
  readonly group?: never;
  readonly reason: EcgPatientAgeValidation;
  readonly route: 'unknown';
}

export interface EcgKnownPatientAge {
  readonly ageDays: number;
  readonly ageYears: number;
  readonly group: EcgPatientAgeGroup;
  readonly route: Exclude<EcgPatientRoute, 'unknown'>;
}

export type EcgPatientAgeResult = EcgUnknownPatientAge | EcgKnownPatientAge;

export const ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL =
  'https://www.ahajournals.org/doi/10.1161/CIRCULATIONAHA.108.191095';

export type EcgPediatricQrsReferenceStatus =
  | 'at-or-above-reference'
  | 'below-reference'
  | 'not-applied'
  | 'not-applicable'
  | 'unavailable';

export interface EcgPediatricQrsReferenceFlag {
  readonly qrsMs?: number;
  readonly sourceUrl: typeof ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL;
  readonly status: EcgPediatricQrsReferenceStatus;
  readonly thresholdMs?: 90 | 100;
}

interface CalendarDate {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseNativeDate(value: string): CalendarDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9_999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return undefined;
  }
  return { day, month, year };
}

function compareDates(left: CalendarDate, right: CalendarDate): number {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

// Gregorian day number, calculated arithmetically to avoid local-time Date behavior.
function daysSinceEpoch(date: CalendarDate): number {
  const adjustedYear = date.year - (date.month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const monthOfYear = date.month + (date.month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthOfYear + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const absoluteMonth = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = (absoluteMonth % 12) + 1;
  return {
    day: Math.min(date.day, daysInMonth(year, month)),
    month,
    year,
  };
}

function addCalendarYears(date: CalendarDate, years: number): CalendarDate {
  const year = date.year + years;
  return {
    day: Math.min(date.day, daysInMonth(year, date.month)),
    month: date.month,
    year,
  };
}

function ageInFullYears(dateOfBirth: CalendarDate, ecgDate: CalendarDate): number {
  const yearDifference = ecgDate.year - dateOfBirth.year;
  return compareDates(ecgDate, addCalendarYears(dateOfBirth, yearDifference)) < 0
    ? yearDifference - 1
    : yearDifference;
}

function ageGroup(
  dateOfBirth: CalendarDate,
  ecgDate: CalendarDate,
  ageDays: number,
): EcgPatientAgeGroup {
  if (ageDays <= 6) return '0–6d';
  if (ageDays <= 30) return '7–30d';
  if (compareDates(ecgDate, addCalendarMonths(dateOfBirth, 3)) < 0) return '1–3mo';
  if (compareDates(ecgDate, addCalendarMonths(dateOfBirth, 6)) < 0) return '3–6mo';
  if (compareDates(ecgDate, addCalendarMonths(dateOfBirth, 12)) < 0) return '6–12mo';
  if (compareDates(ecgDate, addCalendarYears(dateOfBirth, 3)) < 0) return '1–3y';
  if (compareDates(ecgDate, addCalendarYears(dateOfBirth, 5)) < 0) return '3–5y';
  if (compareDates(ecgDate, addCalendarYears(dateOfBirth, 8)) < 0) return '5–8y';
  if (compareDates(ecgDate, addCalendarYears(dateOfBirth, 12)) < 0) return '8–12y';
  if (compareDates(ecgDate, addCalendarYears(dateOfBirth, 16)) < 0) return '12–16y';
  if (compareDates(ecgDate, addCalendarYears(dateOfBirth, 18)) < 0) return '16–17y';
  return 'adult 18+';
}

/**
 * Calculates a deterministic calendar age from native YYYY-MM-DD values.
 * Invalid, reversed, and older-than-120-year inputs stay on the unknown route.
 */
export function calculateEcgPatientAge(input: EcgPatientAgeInput): EcgPatientAgeResult {
  if (input.dateOfBirth === '' || input.ecgDate === '') {
    return { reason: 'missing-date', route: 'unknown' };
  }
  const dateOfBirth = parseNativeDate(input.dateOfBirth);
  const ecgDate = parseNativeDate(input.ecgDate);
  if (!dateOfBirth || !ecgDate) return { reason: 'invalid-date', route: 'unknown' };
  if (compareDates(ecgDate, dateOfBirth) < 0) {
    return { reason: 'before-birth', route: 'unknown' };
  }
  if (compareDates(ecgDate, addCalendarYears(dateOfBirth, 120)) > 0) {
    return { reason: 'over-120-years', route: 'unknown' };
  }

  const ageDays = daysSinceEpoch(ecgDate) - daysSinceEpoch(dateOfBirth);
  const ageYears = ageInFullYears(dateOfBirth, ecgDate);
  const group = ageGroup(dateOfBirth, ecgDate, ageDays);
  return {
    ageDays,
    ageYears,
    group,
    route: ageYears >= 18 ? 'adult' : 'pediatric',
  };
}

/**
 * Applies only the AHA/ACCF/HRS pediatric QRS screening boundaries. This is a reference flag,
 * not a diagnosis; no threshold is invented for the 16–17-year transition group.
 */
export function getEcgPediatricQrsReferenceFlag(
  age: EcgPatientAgeResult,
  qrsMs?: number,
): EcgPediatricQrsReferenceFlag {
  if (age.route === 'unknown' || age.route === 'adult') {
    return {
      sourceUrl: ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
      status: 'not-applicable',
    };
  }
  if (age.ageYears >= 16) {
    return {
      sourceUrl: ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
      status: 'not-applied',
    };
  }
  const thresholdMs: 90 | 100 = age.ageYears < 4 ? 90 : 100;
  if (typeof qrsMs !== 'number' || !Number.isFinite(qrsMs) || qrsMs <= 0) {
    return {
      sourceUrl: ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
      status: 'unavailable',
      thresholdMs,
    };
  }
  return {
    qrsMs,
    sourceUrl: ECG_PEDIATRIC_QRS_REFERENCE_SOURCE_URL,
    status: qrsMs >= thresholdMs ? 'at-or-above-reference' : 'below-reference',
    thresholdMs,
  };
}
