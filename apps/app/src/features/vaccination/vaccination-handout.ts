import {
  isAgeRow,
  type NationalItem,
  type NationalRow,
  plainDoseLabel,
  type VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';
import {
  childAgeLabel,
  displayDate,
  displayIsoDate,
} from '@/features/vaccination/vaccination-format';
import { formatIsoDate } from '@/features/vaccination/vaccination-plan';
import type { DoseMarks } from '@/features/vaccination/vaccination-record';
import {
  buildChildCalendar,
  type ChildCalendar,
  type DoseStatus,
} from '@/features/vaccination/vaccination-status';

/**
 * The sheet for the child's mother: one page in plain words, the vaccinations of every age with the
 * expected date, what has been done (with the date) and what is still to do. Built from the same
 * statuses as the screen, so the page the doctor sees and the page that is printed agree.
 */

export interface HandoutSubject {
  /** Printed when present; the sheet leaves a line for the name otherwise. */
  readonly name: string | null;
  /** ISO date; without it the sheet has empty date lines. */
  readonly birthDate: string | null;
}

export interface HandoutDose {
  /** «Дифтерия, коклюш, столбняк — 1-я прививка». */
  readonly text: string;
  readonly status: DoseStatus;
  /** The date the doctor noted for a done or planned vaccination, `DD.MM.YYYY`; empty otherwise. */
  readonly noted: string;
}

export interface HandoutRow {
  readonly rowId: string;
  readonly age: string;
  /** Expected date: «≈ 17.03.2025», a window as «06.01.2032 — 10.01.2033»; empty without a birth date. */
  readonly when: string;
  readonly doses: readonly HandoutDose[];
}

export interface Handout {
  readonly subject: HandoutSubject;
  /** «1 год 7 мес.»; empty without a birth date. */
  readonly ageText: string;
  readonly rows: readonly HandoutRow[];
  readonly printedOn: string;
}

function doseText(item: NationalItem): string {
  const product = item.product ? ` (${item.product.code})` : '';
  const risk = item.band === 'risk' ? ', для групп риска' : '';
  const every = item.condition ? `, ${item.condition}` : '';
  return `${item.infection} — ${plainDoseLabel(item)}${product}${risk}${every}`;
}

function rowWhen(child: ChildCalendar, row: NationalRow): string {
  const timing = child.timing.get(row.id);
  if (!timing) return '';
  const prefix = timing.approximate ? '≈ ' : '';
  const from = displayDate(timing.from);
  return formatIsoDate(timing.from) === formatIsoDate(timing.to)
    ? `${prefix}${from}`
    : `${prefix}${from} — ${displayDate(timing.to)}`;
}

/** The rows of the sheet: the ages of the national calendar, the adult row last. */
export function buildHandout(
  calendar: VaccinationCalendar,
  columnIds: readonly string[],
  subject: HandoutSubject,
  marks: DoseMarks,
  printedOn: string,
): Handout {
  const child = buildChildCalendar(calendar, columnIds, subject.birthDate, printedOn, marks);
  const rows = calendar.national.rows.filter(isAgeRow).map(
    (row): HandoutRow => ({
      rowId: row.id,
      age: row.ageLabel,
      when: rowWhen(child, row),
      doses: row.items.map((item) => {
        const state = child.doses.get(item.id);
        const mark = state?.mark;
        return {
          text: doseText(item),
          status: state?.status ?? 'later',
          noted: mark?.date ? displayIsoDate(mark.date) : '',
        };
      }),
    }),
  );
  const name = subject.name?.trim() ?? '';
  const birthDate = child.birthDate ?? subject.birthDate;
  return {
    subject: { name: name === '' ? null : name, birthDate: subject.birthDate },
    ageText: birthDate ? childAgeLabel(birthDate, printedOn) : '',
    rows,
    printedOn,
  };
}
