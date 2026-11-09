/**
 * CBT diaries and homework in a patient's diary (CBT1): when an assigned worksheet is due, how its
 * schedule reads, whether what the patient typed fits each column, and the patient's entries as
 * rows of a printed sheet. Pure functions over the diary model; the screens only render them.
 */
import type {
  DiaryAssignment,
  DiaryEntry,
  DiaryInvitation,
  DiarySheetValue,
} from '@/features/diary/diary-model';
import { MAX_DIARY_SHEET_TEXT } from '@/features/diary/diary-model';
import type { WorksheetPrintRow } from '@/features/worksheets/worksheet-print';
import {
  activeWorksheetFields,
  type UserWorksheet,
  type WorksheetField,
} from '@/state/user-worksheet-format';

/** Short weekday names, Monday first (`days` 1…7). */
export const ASSIGNMENT_WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

/** One-line text field: what fits on a printed cell. */
export const MAX_SHEET_LINE = 300;

export function activeAssignments(invitation: DiaryInvitation): readonly DiaryAssignment[] {
  return (invitation.assignments ?? []).filter((assignment) => !assignment.ended);
}

/** Weekday of a day key, 1 Monday … 7 Sunday. */
export function weekdayOf(day: string): number {
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return weekday === 0 ? 7 : weekday;
}

/** The assignment runs on this day (from its first day to its last). */
export function assignmentRuns(assignment: DiaryAssignment, day: string): boolean {
  return day >= assignment.from && (!assignment.until || day <= assignment.until);
}

/** The schedule asks for an entry on this day (an «when it happens» sheet never does). */
export function assignmentDue(assignment: DiaryAssignment, day: string): boolean {
  if (assignment.ended || !assignmentRuns(assignment, day)) return false;
  if (assignment.repeat === 'daily') return true;
  if (assignment.repeat === 'days') return (assignment.days ?? []).includes(weekdayOf(day));
  return false;
}

function dayWordsShort(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** The parts of a schedule, as an assignment or the editor's draft has them. */
export interface AssignmentScheduleParts {
  readonly repeat: DiaryAssignment['repeat'];
  readonly days?: readonly number[] | undefined;
  readonly time?: string | undefined;
  readonly until?: string | undefined;
}

/** «Каждый день в 21:00 · до 20 ноября», «Пн, Ср, Пт», «Когда случится». */
export function assignmentScheduleWords(assignment: AssignmentScheduleParts): string {
  const when =
    assignment.repeat === 'event'
      ? 'Когда случится'
      : assignment.repeat === 'daily'
        ? 'Каждый день'
        : (assignment.days ?? []).map((day) => ASSIGNMENT_WEEKDAY_SHORT[day - 1]).join(', ');
  const time = assignment.time && assignment.repeat !== 'event' ? ` в ${assignment.time}` : '';
  const until = assignment.until ? ` · до ${dayWordsShort(assignment.until)}` : '';
  return `${when}${time}${until}`;
}

/** «Что и когда делать» on the patient's memo: the doctor's words, else the schedule. */
export function assignmentWhat(assignment: DiaryAssignment): string {
  return assignment.what?.trim() || assignmentScheduleWords(assignment);
}

export function assignmentEntries(
  entries: readonly DiaryEntry[],
  assignmentId: string,
): readonly DiaryEntry[] {
  return entries
    .filter((entry) => entry.assignment === assignmentId)
    .toSorted((left, right) => left.at.localeCompare(right.at));
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && !value.trim()) ||
    (Array.isArray(value) && value.length === 0)
  );
}

function rangeOf(field: WorksheetField): { readonly min?: number; readonly max?: number } {
  if (field.type === 'percent') return { min: 0, max: 100 };
  if (field.type === 'scale') return { min: 0, max: 10 };
  if (field.type === 'duration') return { min: 0, max: 1440 };
  return {
    ...(field.min === undefined ? {} : { min: field.min }),
    ...(field.max === undefined ? {} : { max: field.max }),
  };
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** Why one cell does not fit its column, in the patient's words; undefined when it fits. */
export function worksheetCellProblem(field: WorksheetField, value: unknown): string | undefined {
  if (isEmpty(value)) return undefined;
  const name = `«${field.label}»`;
  switch (field.type) {
    case 'text':
      return typeof value === 'string' && value.length <= MAX_SHEET_LINE
        ? undefined
        : `${name}: слишком длинно — до ${MAX_SHEET_LINE} знаков.`;
    case 'long-text':
      return typeof value === 'string' && value.length <= MAX_DIARY_SHEET_TEXT
        ? undefined
        : `${name}: слишком длинно — до ${MAX_DIARY_SHEET_TEXT} знаков.`;
    case 'number':
    case 'percent':
    case 'scale':
    case 'duration': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${name}: нужно число.`;
      const { min, max } = rangeOf(field);
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        return `${name}: от ${min ?? '…'} до ${max ?? '…'}.`;
      }
      if ((field.type === 'scale' || field.type === 'duration') && !Number.isInteger(value)) {
        return `${name}: нужно целое число.`;
      }
      return undefined;
    }
    case 'choice':
      return typeof value === 'string' && field.options?.includes(value)
        ? undefined
        : `${name}: выберите вариант.`;
    case 'multi':
      return Array.isArray(value) &&
        value.every((option) => typeof option === 'string' && field.options?.includes(option))
        ? undefined
        : `${name}: выберите варианты.`;
    case 'time':
      return typeof value === 'string' && TIME.test(value) ? undefined : `${name}: время ЧЧ:ММ.`;
    case 'date':
      return typeof value === 'string' && DAY.test(value) ? undefined : `${name}: нужна дата.`;
  }
}

/** The first problem of a filled sheet, or that nothing is written yet. */
export function worksheetSheetProblem(
  worksheet: UserWorksheet,
  sheet: Readonly<Record<string, unknown>>,
  note = '',
): string | undefined {
  const fields = activeWorksheetFields(worksheet);
  for (const field of fields) {
    const problem = worksheetCellProblem(field, sheet[field.id]);
    if (problem) return problem;
  }
  const filled = fields.some((field) => !isEmpty(sheet[field.id]));
  return filled || note.trim() ? undefined : 'Заполните хотя бы одно поле.';
}

/** Only the cells of the sheet's columns that hold something, as the entry stores them. */
export function cleanSheet(
  worksheet: UserWorksheet,
  sheet: Readonly<Record<string, unknown>>,
): Record<string, DiarySheetValue> {
  const clean: Record<string, DiarySheetValue> = {};
  for (const field of activeWorksheetFields(worksheet)) {
    const value = sheet[field.id];
    if (isEmpty(value)) continue;
    if (typeof value === 'string') clean[field.id] = value.trim();
    else if (typeof value === 'number') clean[field.id] = value;
    else if (Array.isArray(value))
      clean[field.id] = value.filter((item) => typeof item === 'string');
  }
  return clean;
}

/** The patient's entries as rows of the printed sheet, oldest first. */
export function assignmentPrintRows(entries: readonly DiaryEntry[]): readonly WorksheetPrintRow[] {
  return entries
    .filter((entry) => entry.sheet || entry.note)
    .toSorted((left, right) => left.at.localeCompare(right.at))
    .map((entry) => ({
      at: entry.at,
      values: entry.sheet ?? {},
      ...(entry.note ? { note: entry.note } : {}),
    }));
}

/** How many entries since a day (a visit), for the doctor's fact line. */
export function assignmentEntriesSince(
  entries: readonly DiaryEntry[],
  assignmentId: string,
  since: string | undefined,
): number {
  return entries.filter(
    (entry) => entry.assignment === assignmentId && (!since || entry.at.slice(0, 10) >= since),
  ).length;
}

function cellWords(value: DiarySheetValue): string {
  if (typeof value === 'number') return value.toLocaleString('ru-RU');
  if (typeof value === 'string') return value;
  return value.join(', ');
}

/** One line for a filled sheet in a list: its first cells, by column, «Совещание · тревога 70». */
export function sheetSummary(worksheet: UserWorksheet, entry: DiaryEntry): string {
  const parts = worksheet.fields.flatMap((field) => {
    const value = entry.sheet?.[field.id];
    if (value === undefined) return [];
    const words = cellWords(value);
    return [typeof value === 'number' ? `${field.label.toLowerCase()} ${words}` : words];
  });
  const line = [...parts.slice(0, 2), parts.length ? '' : (entry.note ?? '')]
    .filter(Boolean)
    .join(' · ');
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}
