/**
 * A printable worksheet (CBT1): the patient's explanation, what every field means and the memo
 * «если не получилось», then the sheet itself laid out by its declared layout — rows per event,
 * per hour, per weekday, numbered steps, one card, or the text of a material with its practice log.
 * A blank prints empty rows; a filled one prints the patient's rows first. The doctor's notes are
 * not printed: this is the patient's paper.
 */
import { PATIENT_MEMO } from '@/features/worksheets/assignment-memo';
import {
  activeWorksheetFields,
  type UserWorksheet,
  WORKSHEET_WEEKDAYS,
  type WorksheetField,
  worksheetHourRows,
  worksheetPatientCare,
  worksheetPatientNote,
} from '@/state/user-worksheet-format';

/**
 * One filled row: what the patient wrote, keyed by field id, and when. A sheet by hours places
 * the row at the hour of `at`, a week plan on its weekday.
 */
export interface WorksheetPrintRow {
  readonly at?: string;
  readonly values: Readonly<Record<string, unknown>>;
  /** The patient's own words beside the columns. */
  readonly note?: string;
}

function localDay(at: string): string {
  const time = new Date(at);
  const month = String(time.getMonth() + 1).padStart(2, '0');
  const day = String(time.getDate()).padStart(2, '0');
  return `${time.getFullYear()}-${month}-${day}`;
}

function localHour(at: string): string {
  return `${String(new Date(at).getHours()).padStart(2, '0')}:00`;
}

/** Weekday label of a moment, Monday first as on the printed week. */
function weekdayLabel(at: string): string {
  const weekday = new Date(at).getDay();
  return WORKSHEET_WEEKDAYS[weekday === 0 ? 6 : weekday - 1] ?? '';
}

function dated(
  rows: readonly WorksheetPrintRow[],
): readonly (WorksheetPrintRow & { at: string })[] {
  return rows.filter(
    (row): row is WorksheetPrintRow & { at: string } =>
      row.at !== undefined && !Number.isNaN(Date.parse(row.at)),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function scaleNote(field: WorksheetField): string {
  if (field.type === 'percent') return '0–100 %';
  if (field.type === 'scale') return '0–10';
  if (field.type === 'duration') return 'мин';
  if (field.type === 'number' && field.unit) return field.unit;
  return '';
}

function columnTitle(field: WorksheetField): string {
  const note = scaleNote(field);
  const options =
    (field.type === 'choice' || field.type === 'multi') && field.options
      ? `<small>${escapeHtml(field.options.join(' / '))}</small>`
      : '';
  return `${escapeHtml(field.label)}${note ? ` <span class="unit">${escapeHtml(note)}</span>` : ''}${options}`;
}

export function formatWorksheetValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return value.toLocaleString('ru-RU');
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => formatWorksheetValue(item)).join(', ');
  return '';
}

function cellText(row: WorksheetPrintRow | undefined, field: WorksheetField): string {
  return row ? escapeHtml(formatWorksheetValue(row.values[field.id])).replaceAll('\n', '<br>') : '';
}

function rowDate(row: WorksheetPrintRow | undefined): string {
  if (!row?.at) return '';
  const time = new Date(row.at);
  if (Number.isNaN(time.getTime())) return '';
  return escapeHtml(
    time.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
  );
}

function rowClass(fields: readonly WorksheetField[]): string {
  return fields.some((field) => field.type === 'long-text') ? 'tall' : 'short';
}

function noteText(row: WorksheetPrintRow | undefined): string {
  return row?.note ? escapeHtml(row.note).replaceAll('\n', '<br>') : '';
}

function cells(
  fields: readonly WorksheetField[],
  row: WorksheetPrintRow | undefined,
  withNote = false,
): string {
  return `${fields.map((field) => `<td>${cellText(row, field)}</td>`).join('')}${
    withNote ? `<td>${noteText(row)}</td>` : ''
  }`;
}

/** `count` rows: the filled ones first, then empty ones up to `count` (at least one empty). */
function rowsOf(
  filled: readonly WorksheetPrintRow[],
  count: number,
): readonly (WorksheetPrintRow | undefined)[] {
  const empty = Math.max(filled.length > 0 ? 1 : count, count - filled.length);
  return [...filled, ...Array.from({ length: empty }, () => undefined)];
}

function header(fields: readonly WorksheetField[], first: string, withNote = false): string {
  return `<thead><tr><th class="lead">${first}</th>${fields
    .map((field) => `<th>${columnTitle(field)}</th>`)
    .join('')}${withNote ? '<th>Что ещё важно</th>' : ''}</tr></thead>`;
}

function hasNotes(rows: readonly WorksheetPrintRow[]): boolean {
  return rows.some((row) => row.note);
}

function logTable(
  worksheet: UserWorksheet,
  fields: readonly WorksheetField[],
  filled: readonly WorksheetPrintRow[],
): string {
  const notes = hasNotes(filled);
  const rows = rowsOf(filled, worksheet.rows)
    .map(
      (row) =>
        `<tr class="${rowClass(fields)}"><td>${rowDate(row)}</td>${cells(fields, row, notes)}</tr>`,
    )
    .join('');
  return `<table>${header(fields, 'Дата, время', notes)}<tbody>${rows}</tbody></table>`;
}

function hoursTable(
  worksheet: UserWorksheet,
  fields: readonly WorksheetField[],
  filled: readonly WorksheetPrintRow[],
): string {
  // One table per day the patient wrote in, each row at the hour of its entry (the latest wins).
  const byDay = new Map<string, Map<string, WorksheetPrintRow>>();
  for (const row of dated(filled).toSorted((left, right) => left.at.localeCompare(right.at))) {
    const day = localDay(row.at);
    const hours = byDay.get(day) ?? new Map<string, WorksheetPrintRow>();
    hours.set(localHour(row.at), row);
    byDay.set(day, hours);
  }
  const notes = hasNotes(filled);
  const table = (day: string | undefined, rows: ReadonlyMap<string, WorksheetPrintRow>): string => {
    const date = day
      ? escapeHtml(new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU'))
      : '____________';
    const body = worksheetHourRows(worksheet)
      .map(
        (hour) => `<tr class="short"><td>${hour}</td>${cells(fields, rows.get(hour), notes)}</tr>`,
      )
      .join('');
    return `<p class="date-line">Дата: ${date}</p><table>${header(fields, 'Час', notes)}<tbody>${body}</tbody></table>`;
  };
  if (byDay.size === 0) return table(undefined, new Map());
  return [...byDay.entries()].map(([day, rows]) => table(day, rows)).join('');
}

function weekTable(
  worksheet: UserWorksheet,
  fields: readonly WorksheetField[],
  filled: readonly WorksheetPrintRow[],
): string {
  const byDay = new Map<string, WorksheetPrintRow[]>();
  const rowsWithDate = dated(filled).toSorted((left, right) => left.at.localeCompare(right.at));
  for (const row of rowsWithDate) {
    const day = weekdayLabel(row.at);
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  const notes = hasNotes(filled);
  const body = WORKSHEET_WEEKDAYS.map((day) => {
    const rows = rowsOf(byDay.get(day) ?? [], worksheet.rows);
    return rows
      .map(
        (row, index) =>
          `<tr class="short">${index === 0 ? `<td rowspan="${rows.length}" class="day">${day}</td>` : ''}${cells(fields, row, notes)}</tr>`,
      )
      .join('');
  }).join('');
  const first = rowsWithDate[0];
  const since = first ? escapeHtml(new Date(first.at).toLocaleDateString('ru-RU')) : '____________';
  return `<p class="date-line">Неделя с ${since}</p><table>${header(fields, 'День', notes)}<tbody>${body}</tbody></table>`;
}

function ladderTable(
  worksheet: UserWorksheet,
  fields: readonly WorksheetField[],
  filled: readonly WorksheetPrintRow[],
): string {
  const notes = hasNotes(filled);
  const rows = rowsOf(filled, worksheet.rows)
    .map(
      (row, index) =>
        `<tr class="${rowClass(fields)}"><td class="step">${index + 1}</td>${cells(fields, row, notes)}</tr>`,
    )
    .join('');
  return `<table>${header(fields, '№', notes)}<tbody>${rows}</tbody></table>`;
}

function card(fields: readonly WorksheetField[], row: WorksheetPrintRow | undefined): string {
  return `<div class="card">${fields
    .map(
      (field) =>
        `<div class="card-part"><div class="card-label">${columnTitle(field)}</div><div class="card-value">${cellText(row, field)}</div></div>`,
    )
    .join('')}</div>`;
}

function material(worksheet: UserWorksheet): string {
  return worksheet.sections
    .map(
      (section) =>
        `<section class="part"><h3>${escapeHtml(section.title)}</h3>${paragraphs(section.text)}</section>`,
    )
    .join('');
}

function sheet(
  worksheet: UserWorksheet,
  fields: readonly WorksheetField[],
  filled: readonly WorksheetPrintRow[],
): string {
  if (fields.length === 0) return '';
  switch (worksheet.layout) {
    case 'hours':
      return hoursTable(worksheet, fields, filled);
    case 'week':
      return weekTable(worksheet, fields, filled);
    case 'ladder':
      return ladderTable(worksheet, fields, filled);
    case 'card':
      // The card as it stands now: the latest version the patient wrote.
      return card(fields, filled.at(-1));
    case 'log':
    case 'material':
      return logTable(worksheet, fields, filled);
  }
}

function fieldMeanings(fields: readonly WorksheetField[]): string {
  const explained = fields.filter((field) => field.patientHint);
  if (explained.length === 0) return '';
  return `<section class="meanings"><h2>Что значит каждое поле</h2><dl>${explained
    .map((field) => `<dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.patientHint)}</dd>`)
    .join('')}</dl></section>`;
}

/** Landscape when a table has many columns or a day/week grid; portrait for cards and texts. */
export function worksheetPrintIsLandscape(worksheet: UserWorksheet): boolean {
  const columns = activeWorksheetFields(worksheet).length;
  if (worksheet.layout === 'card') return false;
  if (worksheet.layout === 'material') return columns > 3;
  return columns > 3 || worksheet.layout === 'week';
}

export interface WorksheetPrintOptions {
  /** «Что и когда делать» from the assignment, printed in the memo. */
  readonly what?: string;
  /** The patient's pseudonym or name in the header, when the doctor prints for one patient. */
  readonly patient?: string;
}

export function worksheetPrintHtml(
  worksheet: UserWorksheet,
  filled: readonly WorksheetPrintRow[] = [],
  options: WorksheetPrintOptions = {},
): string {
  const fields = activeWorksheetFields(worksheet);
  const note = worksheetPatientNote(worksheet);
  const care = worksheetPatientCare(worksheet);
  const landscape = worksheetPrintIsLandscape(worksheet);
  const what = options.what?.trim();
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(worksheet.title)}</title>
  <style>
    @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #17201c; font-size: 10pt; line-height: 1.4; }
    h1 { margin: 0 0 1mm; font-size: 16pt; }
    h2 { margin: 4mm 0 1.5mm; font-size: 11pt; }
    h3 { margin: 3mm 0 1mm; font-size: 10.5pt; }
    p { margin: 0 0 1.5mm; }
    .patient { margin: 0 0 2mm; color: #405b4e; }
    .intro { margin-bottom: 2mm; }
    .memo { margin: 2mm 0 3mm; padding: 2mm 3mm; border-left: 1mm solid #84968d; background: #f3f6f4; }
    .meanings dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.8mm 4mm; margin: 0; }
    .meanings dt { font-weight: 600; }
    .meanings dd { margin: 0; }
    .part { break-inside: avoid; }
    .date-line { margin: 3mm 0 0; }
    table { width: 100%; margin-top: 3mm; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 0.3mm solid #84968d; padding: 1.2mm 1.5mm; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #eef2ef; font-size: 9pt; text-align: left; overflow-wrap: break-word; hyphens: auto; }
    th small { display: block; font-weight: 400; color: #405b4e; }
    th .unit { font-weight: 400; color: #405b4e; }
    th.lead, td:first-child { width: 27mm; }
    td.step { text-align: center; width: 10mm; }
    td.day { font-weight: 600; overflow-wrap: normal; }
    tr.short td { height: 8mm; }
    tr.tall td { height: 18mm; }
    tr { break-inside: avoid; }
    .card { margin-top: 4mm; border: 0.5mm solid #405b4e; border-radius: 3mm; padding: 3mm 4mm; break-inside: avoid; }
    .card-part { margin-bottom: 3mm; }
    .card-label { font-weight: 600; margin-bottom: 1mm; }
    .card-value { min-height: 18mm; border-bottom: 0.3mm dashed #84968d; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>${escapeHtml(worksheet.title)}</h1>
  ${options.patient ? `<p class="patient">${escapeHtml(options.patient)}</p>` : ''}
  <section class="intro">${paragraphs(note)}</section>
  <section class="memo">
    ${what ? `<p><strong>${PATIENT_MEMO.whatTitle}:</strong> ${escapeHtml(what)}</p>` : ''}
    ${care ? paragraphs(care) : ''}
    <p>${escapeHtml(PATIENT_MEMO.notDone)}</p>
  </section>
  ${worksheet.layout === 'material' ? material(worksheet) : ''}
  ${fieldMeanings(fields)}
  ${sheet(worksheet, fields, filled)}
</body>
</html>`;
}
