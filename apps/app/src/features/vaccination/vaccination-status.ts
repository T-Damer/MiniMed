import {
  isAgeRow,
  type NationalItem,
  type VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';
import {
  addMonths,
  buildChildPlan,
  type CalendarDate,
  compareDates,
  daysBetween,
  PLAN_PROBLEM_MESSAGES,
  type PlanEntry,
  parseIsoDate,
} from '@/features/vaccination/vaccination-plan';
import type { DoseMark, DoseMarks } from '@/features/vaccination/vaccination-record';

/**
 * Where a child stands in the national calendar: every vaccination of an age row gets a status
 * from the child's birth date, today and the marks. The order names ages, not windows or minimum
 * intervals, so «now» is the latest age the child has reached and «overdue» an earlier age without
 * a mark; the calendar does not say more than that.
 */

export type DoseStatus = 'done' | 'planned' | 'now' | 'overdue' | 'later' | 'optional';

/** Worst first: a cell that holds several vaccinations shows the one that needs attention. */
export const STATUS_PRIORITY: readonly DoseStatus[] = [
  'overdue',
  'now',
  'planned',
  'later',
  'optional',
  'done',
];

export type StatusCounts = Readonly<Record<'done' | 'planned' | 'now' | 'overdue', number>>;

export interface DoseState {
  readonly itemId: string;
  readonly rowId: string;
  readonly status: DoseStatus;
  readonly mark: DoseMark | undefined;
}

export interface ColumnTiming {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly approximate: boolean;
  readonly status: PlanEntry['status'];
}

export interface ChildCalendar {
  readonly birthDate: string | null;
  /** Why no dates could be worked out (a future or adult birth date); `null` otherwise. */
  readonly problem: string | null;
  /** The age rows' vaccinations by item id. */
  readonly doses: ReadonlyMap<string, DoseState>;
  readonly counts: StatusCounts;
  /** Date range of each age column by row id; empty without a usable birth date. */
  readonly timing: ReadonlyMap<string, ColumnTiming>;
  /** Today on the age axis as a fractional index into `columnIds`; `null` without a plan. */
  readonly marker: number | null;
}

/** An unmarked vaccination for risk groups is not due for every child. */
function isOptional(item: NationalItem): boolean {
  return item.band === 'risk';
}

function statusOf(
  item: NationalItem,
  mark: DoseMark | undefined,
  timing: ColumnTiming | undefined,
  today: CalendarDate | undefined,
): DoseStatus {
  if (mark?.state === 'done') return 'done';
  if (mark?.state === 'planned') {
    const planned = mark.date ? parseIsoDate(mark.date) : undefined;
    return planned && today && compareDates(planned, today) < 0 ? 'overdue' : 'planned';
  }
  if (isOptional(item)) return 'optional';
  if (!timing) return 'later';
  if (timing.status === 'passed') return 'overdue';
  return timing.status === 'current' ? 'now' : 'later';
}

/**
 * Position of `today` on the age axis. Columns are evenly spaced; between two columns the position
 * follows the time between their dates, so a child of 3.7 months sits just after «3 месяца».
 */
function markerPosition(
  columnIds: readonly string[],
  timing: ReadonlyMap<string, ColumnTiming>,
  adultFrom: CalendarDate,
  today: CalendarDate,
): number | null {
  const dated = columnIds.flatMap((id, index) => {
    const from = timing.get(id)?.from ?? (index === columnIds.length - 1 ? adultFrom : undefined);
    return from ? [{ index, from }] : [];
  });
  let last = -1;
  for (const [position, column] of dated.entries()) {
    if (compareDates(column.from, today) <= 0) last = position;
  }
  const current = dated[last];
  if (!current) return null;
  const next = dated[last + 1];
  if (!next) return current.index;
  const span = daysBetween(current.from, next.from);
  const gone = daysBetween(current.from, today);
  return current.index + (next.index - current.index) * (span === 0 ? 0 : gone / span);
}

/**
 * Statuses of every vaccination of the age rows. `columnIds` are the row ids of the chart's age
 * columns in order (the last is the adult one); a missing or unusable birth date leaves the
 * statuses to the marks alone.
 */
export function buildChildCalendar(
  calendar: VaccinationCalendar,
  columnIds: readonly string[],
  birthDate: string | null,
  today: string,
  marks: DoseMarks,
): ChildCalendar {
  const now = parseIsoDate(today);
  const plan = birthDate ? buildChildPlan(calendar.national.rows, birthDate, today) : undefined;
  const timing = new Map<string, ColumnTiming>();
  if (plan?.kind === 'plan') {
    for (const entry of plan.entries) {
      timing.set(entry.rowId, {
        from: entry.from,
        to: entry.to,
        approximate: entry.approximate,
        status: entry.status,
      });
    }
  }
  const doses = new Map<string, DoseState>();
  const tally = { done: 0, planned: 0, now: 0, overdue: 0 };
  for (const row of calendar.national.rows) {
    if (!isAgeRow(row)) continue;
    for (const item of row.items) {
      const mark = marks[item.id];
      const status = statusOf(item, mark, timing.get(row.id), now);
      doses.set(item.id, { itemId: item.id, rowId: row.id, status, mark });
      if (status === 'done' || status === 'planned' || status === 'now' || status === 'overdue') {
        tally[status] += 1;
      }
    }
  }
  const parsedBirth = birthDate ? parseIsoDate(birthDate) : undefined;
  const marker =
    plan?.kind === 'plan' && parsedBirth && now
      ? markerPosition(columnIds, timing, addMonths(parsedBirth, 18 * 12), now)
      : null;
  return {
    birthDate: plan?.kind === 'plan' ? birthDate : null,
    problem: plan?.kind === 'problem' ? PLAN_PROBLEM_MESSAGES[plan.problem] : null,
    doses,
    counts: tally,
    timing,
    marker,
  };
}

/** The status a cell shows when it holds several vaccinations. */
export function worstStatus(statuses: readonly DoseStatus[]): DoseStatus | undefined {
  return STATUS_PRIORITY.find((status) => statuses.includes(status));
}

/** Item ids of vaccinations whose age has passed without a mark: what «mark all» sets as done. */
export function overdueItemIds(child: ChildCalendar): readonly string[] {
  return [...child.doses.values()]
    .filter((dose) => dose.status === 'overdue' && dose.mark?.state !== 'planned')
    .map((dose) => dose.itemId);
}
