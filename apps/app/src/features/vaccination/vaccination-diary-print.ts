import type {
  VaccinationBand,
  VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';
import {
  CHART_BAND_LABELS,
  CHART_GROUP_LABELS,
  type ChartCell,
  type ChartDose,
} from '@/features/vaccination/vaccination-chart';
import type { DiaryDate, DiarySheet } from '@/features/vaccination/vaccination-diary';
import { displayIsoDate, escapeHtml } from '@/features/vaccination/vaccination-print';

/**
 * A4 landscape print of the personal vaccination diary: the national calendar as a chart of
 * infections × ages, the planned date under every dose and an empty box for the mark. One page.
 */

export const VACCINATION_DIARY_TITLE = 'Личный дневник прививок';

const DIARY_STYLES = `
  @page { size: A4 landscape; margin: 7mm 8mm 7mm 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .vax-diary { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; font-size: 7pt; line-height: 1.2; -webkit-print-color-adjust: exact; print-color-adjust: exact; break-inside: avoid; page-break-inside: avoid; }
  .vax-diary__head { display: grid; grid-template-columns: 1fr auto; gap: 0 6mm; align-items: end; margin: 0 0 1.5mm; }
  .vax-diary__title { margin: 0; font-size: 13pt; line-height: 1.1; }
  .vax-diary__source { margin: 0.5mm 0 0; font-size: 6.5pt; color: #333; }
  .vax-diary__child { display: grid; grid-template-columns: auto 1fr; gap: 1mm 2mm; align-items: end; margin: 0; font-size: 8pt; min-width: 98mm; }
  .vax-diary__child-label { font-weight: bold; }
  .vax-diary__child-value { min-height: 4.4mm; border-bottom: 0.25mm solid #000; padding: 0 1mm; }
  .vax-diary__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .vax-diary__head-cell { border: 0.25mm solid #000; padding: 0.6mm 0.4mm; text-align: center; font-weight: bold; background: #f1f1f1; font-size: 7pt; }
  .vax-diary__head-cell--group { font-size: 6.5pt; background: #e2e2e2; }
  .vax-diary__head-cell--corner { text-align: left; font-size: 7.5pt; width: 30mm; }
  .vax-diary__age-label { display: block; font-weight: normal; font-size: 5.5pt; color: #333; }
  .vax-diary__infection { border: 0.25mm solid #000; padding: 0.6mm 1.2mm; text-align: left; font-weight: bold; font-size: 7.5pt; background: #f7f7f7; }
  .vax-diary__cell { border: 0.25mm solid #000; padding: 0.4mm; vertical-align: top; }
  .vax-diary__cell--all { background: #fff; }
  .vax-diary__cell--covered-catch-up { background: #e6eefa; }
  .vax-diary__cell--covered-risk { background: #fdf0dc; }
  .vax-diary__cell--covered-all { background: #eef8ec; }
  .vax-diary__dose { margin: 0; border: 0.2mm solid #666; background: #fff; }
  .vax-diary__dose + .vax-diary__dose { margin-top: 0.6mm; }
  .vax-diary__dose-head { display: block; padding: 0.2mm 0.6mm; line-height: 1.1; }
  .vax-diary__dose-top { display: block; }
  .vax-diary__dose-head--all { background: #bfe3b8; }
  .vax-diary__dose-head--risk { background: #f9cf8f; }
  .vax-diary__dose-head--catch-up { background: #b9d4f2; }
  .vax-diary__dose-label { font-weight: bold; font-size: 7.5pt; }
  .vax-diary__dose-product { display: block; font-size: 6pt; font-weight: bold; white-space: nowrap; }
  .vax-diary__dose-date { display: block; font-size: 6pt; white-space: nowrap; }
  .vax-diary__dose-date-end { display: block; font-size: 6pt; white-space: nowrap; }
  .vax-diary__dose--group .vax-diary__dose-label { font-size: 6.5pt; }
  .vax-diary__mark { display: block; height: 3.6mm; border-top: 0.2mm dashed #666; }
  .vax-diary__legend { display: grid; grid-template-columns: auto 1fr; gap: 1mm 4mm; margin: 2mm 0 0; font-size: 6.8pt; }
  .vax-diary__legend-title { margin: 0; font-weight: bold; }
  .vax-diary__legend-items { display: flex; flex-wrap: wrap; gap: 0.6mm 5mm; margin: 0; padding: 0; list-style: none; }
  .vax-diary__legend-item { display: inline-flex; align-items: center; gap: 1.2mm; }
  .vax-diary__swatch { display: inline-block; width: 7mm; height: 3.4mm; border: 0.2mm solid #666; }
  .vax-diary__swatch--all { background: #bfe3b8; }
  .vax-diary__swatch--risk { background: #f9cf8f; }
  .vax-diary__swatch--catch-up { background: #b9d4f2; }
  .vax-diary__swatch--mark { background: #fff; border-style: dashed; }
  .vax-diary__foot { margin: 1.6mm 0 0; font-size: 6pt; color: #333; }
`;

function doseDate(date: DiaryDate | undefined): string {
  if (!date) return '';
  const lead = date.approximate ? '≈ ' : '';
  const end = date.to
    ? `<span class="vax-diary__dose-date-end">— ${escapeHtml(date.to)}</span>`
    : '';
  return `<span class="vax-diary__dose-date">${lead}${escapeHtml(date.from)}</span>${end}`;
}

function doseHtml(dose: ChartDose, date: DiaryDate | undefined): string {
  const risk = dose.band === 'risk' ? '*' : '';
  const product = dose.product
    ? `<span class="vax-diary__dose-product">${escapeHtml(dose.product.code)}${
        dose.product.riskCode ? `/${escapeHtml(dose.product.riskCode)}` : ''
      }</span>`
    : '';
  // A dose of a category row names a group, not an age: no planned date and no mark box.
  const mark = dose.category ? '' : '<span class="vax-diary__mark"></span>';
  const modifier = dose.category ? ' vax-diary__dose--group' : '';
  return `<div class="vax-diary__dose${modifier}" title="${escapeHtml(dose.text)}"><span class="vax-diary__dose-head vax-diary__dose-head--${dose.band}"><span class="vax-diary__dose-top"><span class="vax-diary__dose-label">${escapeHtml(
    dose.label,
  )}${risk}</span>${product}</span>${dose.category ? '' : doseDate(date)}</span>${mark}</div>`;
}

function cellHtml(cell: ChartCell, date: DiaryDate | undefined): string {
  const covered = cell.covered
    ? `vax-diary__cell--covered-${cell.covered}`
    : 'vax-diary__cell--all';
  return `<td class="vax-diary__cell ${covered}">${cell.doses
    .map((dose) => doseHtml(dose, date))
    .join('')}</td>`;
}

function legendHtml(sheet: DiarySheet): string {
  const bands = sheet.chart.bands
    .map(
      (band: VaccinationBand) =>
        `<li class="vax-diary__legend-item"><span class="vax-diary__swatch vax-diary__swatch--${band}"></span>${escapeHtml(
          CHART_BAND_LABELS[band],
        )}${band === 'risk' ? ' (*)' : ''}</li>`,
    )
    .join('');
  const labels = new Map(sheet.chart.products.map((product) => [product.code, product.label]));
  const codes = new Set<string>();
  for (const product of sheet.chart.products) {
    codes.add(product.code);
    if (product.riskCode) codes.add(product.riskCode);
  }
  const products = [...codes]
    .map(
      (code) =>
        `<li class="vax-diary__legend-item"><b>${escapeHtml(code)}</b> — ${escapeHtml(
          labels.get(code) ?? code,
        )}</li>`,
    )
    .join('');
  const riskNote = sheet.chart.products.some((product) => product.riskCode)
    ? '<li class="vax-diary__legend-item">для детей групп риска — по приказу (приложение № 3)</li>'
    : '';
  return `<div class="vax-diary__legend">
<p class="vax-diary__legend-title">Цвет:</p>
<ul class="vax-diary__legend-items">${bands}<li class="vax-diary__legend-item"><span class="vax-diary__swatch vax-diary__swatch--mark"></span>пустое поле под датой — для отметки о сделанной прививке (дата, подпись)</li></ul>
<p class="vax-diary__legend-title">Обозначения:</p>
<ul class="vax-diary__legend-items"><li class="vax-diary__legend-item"><b>V</b> — вакцинация</li><li class="vax-diary__legend-item"><b>RV</b> — ревакцинация</li><li class="vax-diary__legend-item">цифра — номер прививки в названии</li>${products}${riskNote}</ul>
</div>`;
}

/** The whole print document of the diary. */
export function renderVaccinationDiaryHtml(
  calendar: VaccinationCalendar,
  sheet: DiarySheet,
): string {
  const { chart } = sheet;
  const groups = chart.groups
    .map(
      (group) =>
        `<th class="vax-diary__head-cell vax-diary__head-cell--group" colspan="${group.span}">${escapeHtml(
          CHART_GROUP_LABELS[group.group],
        )}</th>`,
    )
    .join('');
  const ages = chart.columns
    .map(
      (column) =>
        `<th class="vax-diary__head-cell" title="${escapeHtml(column.ageLabel)}">${escapeHtml(column.shortLabel)}</th>`,
    )
    .join('');
  const body = chart.rows
    .map(
      (row) =>
        `<tr><th class="vax-diary__infection" scope="row">${escapeHtml(row.label)}</th>${chart.columns
          .map((column) => {
            const cell = row.cells.get(column.rowId) ?? { doses: [], covered: null };
            return cellHtml(cell, sheet.dates.get(column.rowId));
          })
          .join('')}</tr>`,
    )
    .join('');
  const name = sheet.subject.name ? escapeHtml(sheet.subject.name) : '';
  const birth = sheet.subject.birthDate ? escapeHtml(displayIsoDate(sheet.subject.birthDate)) : '';
  const planNote = sheet.subject.birthDate
    ? 'Даты рассчитаны от даты рождения по возрасту, указанному в приказе; приказ дат не называет (≈ — приблизительная дата, при окне возраста — его границы). Фактические сроки определяет врач: учитываются уже сделанные прививки, противопоказания и инструкции к вакцинам. '
    : 'Даты не рассчитаны: дата рождения не указана. ';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(VACCINATION_DIARY_TITLE)}</title>
<style>${DIARY_STYLES}</style>
</head>
<body class="vax-diary">
<header class="vax-diary__head">
<div>
<h1 class="vax-diary__title">${escapeHtml(VACCINATION_DIARY_TITLE)}</h1>
<p class="vax-diary__source">${escapeHtml(calendar.national.title)}. ${escapeHtml(
    calendar.edition.label,
  )}, приложение № 1.</p>
</div>
<p class="vax-diary__child"><span class="vax-diary__child-label">Ребёнок:</span><span class="vax-diary__child-value">${name}</span><span class="vax-diary__child-label">Дата рождения:</span><span class="vax-diary__child-value">${birth}</span></p>
</header>
<table class="vax-diary__table">
<colgroup><col style="width:30mm" />${chart.columns.map(() => '<col />').join('')}</colgroup>
<thead>
<tr><th class="vax-diary__head-cell vax-diary__head-cell--corner" rowspan="2">Инфекция</th>${groups}</tr>
<tr>${ages}</tr>
</thead>
<tbody>${body}</tbody>
</table>
${legendHtml(sheet)}
<p class="vax-diary__foot">${planNote}Возраст указан в днях, месяцах и годах жизни. Таблица составлена по приложению № 1 приказа; не заменяет приказ и инструкции к вакцинам. Распечатано из MiniMed ${escapeHtml(
    displayIsoDate(sheet.printedOn),
  )}.</p>
</body>
</html>`;
}
