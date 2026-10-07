import type { VaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import { buildNationalChart, type NationalChart } from '@/features/vaccination/vaccination-chart';
import {
  buildChildPlan,
  type CalendarDate,
  PLAN_PROBLEM_MESSAGES,
  type PlanEntry,
} from '@/features/vaccination/vaccination-plan';

/**
 * The model of the printed «личный дневник прививок»: the chart of the national calendar plus, when
 * a birth date is known, the planned date of every age column. The structure is the chart's
 * (data-driven); this module only adds the child and the dates.
 */

export interface DiarySubject {
  /** Printed when present; the sheet leaves a blank line for the name otherwise. */
  readonly name: string | null;
  /** ISO date; without it the sheet is the blank chart with empty marks. */
  readonly birthDate: string | null;
}

export interface DiaryDate {
  /** `15.03.26`. */
  readonly from: string;
  /** Last day of a window the order names (3–7 days, 6–7 years); `null` for a point age. */
  readonly to: string | null;
  readonly approximate: boolean;
}

export interface DiarySheet {
  readonly subject: DiarySubject;
  readonly chart: NationalChart;
  /** Planned date by column row id; empty without a birth date. */
  readonly dates: ReadonlyMap<string, DiaryDate>;
  readonly printedOn: string;
}

export type DiaryResult =
  | { readonly kind: 'sheet'; readonly sheet: DiarySheet }
  | { readonly kind: 'problem'; readonly message: string };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function shortDate(date: CalendarDate): string {
  return `${pad(date.day)}.${pad(date.month)}.${pad(date.year % 100)}`;
}

function sameDay(left: CalendarDate, right: CalendarDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

function diaryDate(entry: PlanEntry): DiaryDate {
  return {
    from: shortDate(entry.from),
    to: sameDay(entry.from, entry.to) ? null : shortDate(entry.to),
    approximate: entry.approximate,
  };
}

/**
 * Builds the sheet. A birth date the plan cannot use (future, an adult) is reported as a problem
 * instead of printing dates that mean nothing; no date at all gives the blank chart.
 */
export function buildDiarySheet(
  calendar: VaccinationCalendar,
  subject: DiarySubject,
  printedOn: string,
): DiaryResult {
  const chart = buildNationalChart(calendar);
  const dates = new Map<string, DiaryDate>();
  if (subject.birthDate) {
    const plan = buildChildPlan(calendar.national.rows, subject.birthDate, printedOn);
    if (plan.kind === 'problem') {
      return { kind: 'problem', message: PLAN_PROBLEM_MESSAGES[plan.problem] };
    }
    for (const entry of plan.entries) dates.set(entry.rowId, diaryDate(entry));
  }
  const name = subject.name?.trim() ?? '';
  return {
    kind: 'sheet',
    sheet: {
      subject: { name: name === '' ? null : name, birthDate: subject.birthDate },
      chart,
      dates,
      printedOn,
    },
  };
}
