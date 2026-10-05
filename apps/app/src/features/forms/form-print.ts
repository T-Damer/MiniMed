import type { FormField, FormRow, FormSchema, FormSegment } from '@localmed/contracts';

import { type FormValues, listValue, textValue } from '@/features/forms/form-values';

const MONTHS_GENITIVE = [
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** `2026-10-05` printed in the three blanks of «__» ______ 20__ г.; empty when not a date. */
export function datePart(value: string, part: 'day' | 'month' | 'year2'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return '';
  const [, year = '', month = '', day = ''] = match;
  if (part === 'day') return day;
  if (part === 'year2') return year.slice(2);
  return MONTHS_GENITIVE[Number(month) - 1] ?? '';
}

/** `2026-10-05` as `05.10.2026` for screens and summaries. */
export function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

const FORM_PRINT_STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .form-print { font-family: "Times New Roman", Times, serif; line-height: 1.3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .form-print__block { display: flex; align-items: flex-start; column-gap: 6mm; margin-top: 1.5mm; }
  .form-print__column { flex: 0 0 auto; min-width: 0; }
  .form-print__column--center { text-align: center; }
  .form-print__row { display: flex; flex-wrap: wrap; align-items: flex-end; column-gap: 0.45em; }
  .form-print__row--center { justify-content: center; }
  .form-print__row--right { justify-content: flex-end; }
  .form-print__row--justify { text-align: justify; }
  .form-print__row--gap-small { margin-top: 1.2mm; }
  .form-print__row--gap-medium { margin-top: 3mm; }
  .form-print__row--gap-large { margin-top: 7mm; }
  .form-print__row--small { font-size: 0.85em; }
  .form-print__row--title { font-size: 1.2em; }
  .form-print__row--bold { font-weight: bold; }
  .form-print__row--outline { border: 0.25mm solid #000; padding: 0.8mm 1.5mm; }
  .form-print__row--split { align-items: stretch; column-gap: 0; }
  .form-print__cell { border: 0.25mm solid #000; padding: 0.8mm 1.5mm; display: flex; align-items: flex-end; }
  .form-print__cell--grow { flex: 1 1 auto; border-left: 0; }
  .form-print__text { flex: 0 1 auto; }
  .form-print__text--bold { font-weight: bold; }
  .form-print__text--small { font-size: 0.85em; }
  .form-print__field { display: inline-flex; flex-direction: column; flex: 0 0 auto; }
  .form-print__field--grow { flex: 1 1 auto; }
  .form-print__field--lines { flex: 1 1 100%; }
  .form-print__blank {
    display: block;
    min-height: 1.3em;
    padding: 0 0.3em;
    border-bottom: 0.2mm solid #000;
    overflow-wrap: anywhere;
  }
  .form-print__blank--centered { text-align: center; }
  .form-print__caption { font-size: 0.72em; text-align: center; line-height: 1.1; }
  .form-print__option { white-space: nowrap; }
  .form-print__option--picked { border: 0.25mm solid #000; border-radius: 1em; padding: 0 0.3em; }
  .form-print__separator { white-space: pre; }
  .form-print__check {
    display: inline-block;
    width: 4mm;
    height: 4mm;
    margin-left: auto;
    border: 0.25mm solid #000;
    text-align: center;
    line-height: 3.6mm;
    font-weight: bold;
  }
  .form-print__stamp { font-size: 1em; }
  .form-print__block--framed { display: block; border: 0.25mm solid #000; padding: 0.5mm 1mm; margin-top: 2mm; }
  .form-print__block--page-break { break-before: page; page-break-before: always; }
  .form-print__block--framed .form-print__column { width: 100% !important; }
  .form-print__blank--lines {
    line-height: 1.55em;
    min-height: 0;
    border-bottom: 0;
    background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.55em - 0.2mm), #000 calc(1.55em - 0.2mm), #000 1.55em);
    background-size: 100% 1.55em;
  }
  .form-print__option--underlined { text-decoration: underline; }
  .form-print__table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 0.8mm; }
  .form-print__cell-head, .form-print__cell-body {
    border: 0.25mm solid #000;
    padding: 0.3mm 0.8mm;
    text-align: center;
    overflow-wrap: anywhere;
    font-weight: normal;
  }
  .form-print__cell-head { font-size: 0.95em; }
  .form-print__cell-body { min-height: 1.5em; height: 1.6em; text-align: left; }
  .form-print__table-caption, .form-print__cell-caption { text-align: left; }
`;

function blank(value: string, length: number, centered: boolean, lines?: number): string {
  const classes = [
    'form-print__blank',
    ...(centered ? ['form-print__blank--centered'] : []),
    ...(lines ? ['form-print__blank--lines'] : []),
  ];
  const height = lines ? `;min-height:${lines * 1.55}em` : '';
  return `<span class="${classes.join(' ')}" style="min-width:${length}ch${height}">${escapeHtml(value)}</span>`;
}

function fieldById(schema: FormSchema, id: string): FormField {
  const field = schema.fields.find((candidate) => candidate.id === id);
  if (!field) throw new Error(`Схема ссылается на неизвестное поле ${id}.`);
  return field;
}

type TableSegment = Extract<FormSegment, { kind: 'table' }>;

function tableHtml(schema: FormSchema, values: FormValues, segment: TableSegment): string {
  const weights = segment.columnWeights;
  const total = weights ? weights.reduce((sum, weight) => sum + weight, 0) : 0;
  const colgroup = weights
    ? `<colgroup>${weights.map((weight) => `<col style="width:${((weight / total) * 100).toFixed(2)}%">`).join('')}</colgroup>`
    : '';
  const head = segment.header
    .map((cells) => {
      const tds = cells
        .map((cell) => {
          const attributes = [
            ...(cell.colSpan ? [`colspan="${cell.colSpan}"`] : []),
            ...(cell.rowSpan ? [`rowspan="${cell.rowSpan}"`] : []),
          ];
          const caption = segment.header.length === 1 && cells.length === 1;
          return `<th class="form-print__cell-head${caption ? ' form-print__table-caption' : ''}" ${attributes.join(' ')}>${escapeHtml(cell.text)}</th>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  const body = segment.rows
    .map((cells) => {
      const tds = cells
        .map((cell) => {
          if (typeof cell !== 'string') {
            return `<td class="form-print__cell-body form-print__cell-caption">${escapeHtml(cell.text)}</td>`;
          }
          const field = fieldById(schema, cell);
          const shown =
            field.type === 'date'
              ? displayDate(textValue(values[field.id]))
              : displayFieldValue(field, values[field.id]);
          return `<td class="form-print__cell-body">${escapeHtml(shown)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<table class="form-print__table">${colgroup}<thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function segmentHtml(schema: FormSchema, values: FormValues, segment: FormSegment): string {
  if (segment.kind === 'text') {
    const classes = [
      'form-print__text',
      ...(segment.bold ? ['form-print__text--bold'] : []),
      ...(segment.small ? ['form-print__text--small'] : []),
    ];
    return `<span class="${classes.join(' ')}">${escapeHtml(segment.text)}</span>`;
  }
  if (segment.kind === 'stamp') {
    return `<span class="form-print__stamp">${escapeHtml(segment.text)}</span>`;
  }
  if (segment.kind === 'table') return tableHtml(schema, values, segment);
  const field = fieldById(schema, segment.fieldId);
  const value = values[field.id];
  if (segment.kind === 'check') {
    return `<span class="form-print__check" aria-label="${escapeHtml(field.label)}">${value === true ? '✓' : ''}</span>`;
  }
  if (segment.kind === 'signature') {
    return `<span class="form-print__field" style="min-width:${segment.length}ch">${blank('', segment.length, false)}<span class="form-print__caption">${escapeHtml(segment.caption)}</span></span>`;
  }
  if (segment.kind === 'options') {
    const picked = new Set(listValue(value));
    const mark =
      segment.mark === 'underline'
        ? 'form-print__option--underlined'
        : 'form-print__option--picked';
    const items = (field.options ?? []).map(
      (option) =>
        `<span class="form-print__option${picked.has(option.value) ? ` ${mark}` : ''}">${escapeHtml(option.label)}${segment.codes === false ? '' : ` – ${escapeHtml(option.value)}`}</span>`,
    );
    return `<span class="form-print__options">${items.join(`<span class="form-print__separator">${escapeHtml(segment.separator)}</span>`)}</span>`;
  }
  const text = textValue(value);
  const shown = segment.part ? datePart(text, segment.part) : displayFieldValue(field, value);
  const centered = segment.part !== undefined;
  const inner = blank(shown, segment.length, centered, segment.lines);
  const classes = [
    'form-print__field',
    ...(segment.grow ? ['form-print__field--grow'] : []),
    ...(segment.lines ? ['form-print__field--lines'] : []),
  ];
  const caption = segment.caption
    ? `<span class="form-print__caption">${escapeHtml(segment.caption)}</span>`
    : '';
  return `<span class="${classes.join(' ')}" style="${segment.grow && !segment.lines ? `flex-basis:${segment.length}ch;` : ''}min-width:${segment.length}ch">${inner}${caption}</span>`;
}

function displayFieldValue(field: FormField, value: FormValues[string] | undefined): string {
  if (field.type === 'choice') {
    // A code blank prints the code itself, as on the official blank.
    return listValue(value).join(', ');
  }
  return textValue(value);
}

function rowHtml(schema: FormSchema, values: FormValues, row: FormRow): string {
  const classes = [
    'form-print__row',
    ...(row.align ? [`form-print__row--${row.align}`] : []),
    ...(row.size && row.size !== 'normal' ? [`form-print__row--${row.size}`] : []),
    ...(row.bold ? ['form-print__row--bold'] : []),
    ...(row.gap && row.gap !== 'none' ? [`form-print__row--gap-${row.gap}`] : []),
    ...(row.box ? [`form-print__row--${row.box}`] : []),
  ];
  const parts = row.segments.map((segment) => segmentHtml(schema, values, segment));
  if (row.box === 'split') {
    const [first = '', ...rest] = parts;
    const width = row.splitPercent ?? 30;
    return `<div class="${classes.join(' ')}"><div class="form-print__cell" style="width:${width}%">${first}</div><div class="form-print__cell form-print__cell--grow">${rest.join('')}</div></div>`;
  }
  return `<div class="${classes.join(' ')}">${parts.join('')}</div>`;
}

/**
 * The filled blank as a standalone HTML page, laid out from the schema's layout block. Used for
 * the in-app preview and handed to the print manager; it knows no form ids.
 */
export function renderFormPrintHtml(schema: FormSchema, values: FormValues): string {
  const { page } = schema.layout;
  const margin = page.marginMm;
  const blocks = schema.layout.blocks
    .map((block) => {
      const columns = block.columns
        .map((column) => {
          const align = column.align === 'center' ? ' form-print__column--center' : '';
          const rows = column.rows.map((row) => rowHtml(schema, values, row)).join('');
          return `<div class="form-print__column${align}" style="width:${column.widthPercent}%">${rows}</div>`;
        })
        .join('');
      const classes = [
        'form-print__block',
        ...(block.framed ? ['form-print__block--framed'] : []),
        ...(block.pageBreakBefore ? ['form-print__block--page-break'] : []),
      ];
      return `<section class="${classes.join(' ')}" data-block="${escapeHtml(block.id)}">${columns}</section>`;
    })
    .join('');
  const title = `Форма № ${schema.formNumber} — ${schema.title}`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>@page { size: A4 ${page.orientation}; margin: ${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm; }
${FORM_PRINT_STYLES}
.form-print { font-size: ${page.fontSizePt}pt; }
@media screen { body { padding: ${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm; } .form-print__block--page-break { margin-top: 8mm; padding-top: 5mm; border-top: 0.3mm dashed #888; } }</style>
</head>
<body><article class="form-print" aria-label="${escapeHtml(title)}">${blocks}</article></body>
</html>`;
}

export function formPrintTitle(schema: FormSchema): string {
  return `Форма № ${schema.formNumber} — ${schema.title}`;
}
