import {
  type EpidemicRow,
  type NationalRow,
  type ProcedureItem,
  pdfPagesLabel,
  type VaccinationBlock,
  type VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';
import { buildSummaryGrid } from '@/features/vaccination/vaccination-grid';

/** A4 landscape print of the calendars exactly as the order prints them, plus the summary grid. */

export const VACCINATION_PRINT_TITLE = 'Календарь профилактических прививок — приказ № 1122н';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** `2026-10-05` as `05.10.2026`. */
export function displayIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

const PRINT_STYLES = `
  @page { size: A4 landscape; margin: 10mm 10mm 12mm 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .vax-print { font-family: "Times New Roman", Times, serif; font-size: 9.5pt; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .vax-print__title { margin: 0 0 1mm; font-size: 14pt; text-align: center; }
  .vax-print__edition { margin: 0 0 3mm; text-align: center; font-size: 10pt; font-weight: bold; }
  .vax-print__meta { margin: 0 0 3mm; font-size: 8.5pt; }
  .vax-print__section { margin: 0; }
  .vax-print__section--page { break-before: page; page-break-before: always; }
  .vax-print__heading { margin: 0 0 1.5mm; font-size: 11pt; text-align: center; }
  .vax-print__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .vax-print__table thead { display: table-header-group; }
  .vax-print__running { font-weight: normal; font-size: 8pt; text-align: left; border: 0; padding: 0 0 1mm; }
  .vax-print__cell, .vax-print__head-cell { border: 0.25mm solid #000; padding: 1mm 1.5mm; vertical-align: top; text-align: left; }
  .vax-print__head-cell { text-align: center; font-weight: normal; }
  .vax-print__row { break-inside: avoid; page-break-inside: avoid; }
  .vax-print__number { text-align: right; }
  .vax-print__page { display: block; margin-top: 1mm; font-size: 7pt; color: #333; text-align: right; }
  .vax-print__item { margin: 0; padding: 0.6mm 0; }
  .vax-print__item + .vax-print__item { border-top: 0.25mm solid #000; margin-top: 0.6mm; padding-top: 1.2mm; }
  .vax-print__block { margin: 0; }
  .vax-print__block + .vax-print__block { margin-top: 0.6mm; }
  .vax-print__block--bullet { padding-left: 2.2mm; text-indent: -2.2mm; }
  .vax-print__grid { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5pt; }
  .vax-print__grid .vax-print__cell, .vax-print__grid .vax-print__head-cell { padding: 0.8mm 0.6mm; text-align: center; vertical-align: middle; }
  .vax-print__grid .vax-print__infection { text-align: left; font-weight: bold; }
  .vax-print__dose { display: block; white-space: nowrap; }
  .vax-print__legend { margin: 1.5mm 0 3mm; font-size: 8pt; }
  .vax-print__previous { margin: 1.5mm 0 0; font-size: 8pt; }
  .vax-print__procedure { margin: 0 0 1.4mm; text-align: justify; break-inside: avoid; page-break-inside: avoid; }
  .vax-print__footnote { margin: 0 0 0 4mm; font-size: 8pt; }
  .vax-print__footer { margin-top: 4mm; font-size: 8pt; border-top: 0.25mm solid #000; padding-top: 1.5mm; break-inside: avoid; page-break-inside: avoid; }
  .vax-print__footer p { margin: 0 0 1mm; }
`;

function sourceLine(calendar: VaccinationCalendar): string {
  const files = calendar.sources
    .map(
      (source) =>
        `${escapeHtml(source.orderNumber)}: ${escapeHtml(source.publicationUrl)} (PDF ${escapeHtml(source.pdfUrl)})`,
    )
    .join('; ');
  return `Официальные публикации на publication.pravo.gov.ru — ${files}.`;
}

function runningHead(calendar: VaccinationCalendar, title: string, columns: number): string {
  return `<tr><th class="vax-print__running" colspan="${columns}">${escapeHtml(title)} — ${escapeHtml(
    calendar.edition.editionLine,
  )}</th></tr>`;
}

function columnHeads(columns: readonly string[]): string {
  return `<tr>${columns
    .map((column) => `<th class="vax-print__head-cell">${escapeHtml(column)}</th>`)
    .join('')}</tr>`;
}

function blockHtml(block: VaccinationBlock): string {
  return block.kind === 'bullet'
    ? `<p class="vax-print__block vax-print__block--bullet">- ${escapeHtml(block.text)}</p>`
    : `<p class="vax-print__block">${escapeHtml(block.text)}</p>`;
}

function numberCell(row: {
  readonly number: string;
  readonly source: { pdfPages: number[] };
}): string {
  return `<td class="vax-print__cell vax-print__number">${escapeHtml(row.number)}.<span class="vax-print__page">PDF ${escapeHtml(
    pdfPagesLabel(row.source.pdfPages),
  )}</span></td>`;
}

function nationalRowHtml(row: NationalRow): string {
  return `<tr class="vax-print__row">${numberCell(row)}<td class="vax-print__cell">${escapeHtml(
    row.category,
  )}</td><td class="vax-print__cell">${row.items
    .map((item) => `<p class="vax-print__item">${escapeHtml(item.text)}</p>`)
    .join('')}</td></tr>`;
}

function epidemicRowHtml(row: EpidemicRow): string {
  const amended = row.amendedBy
    ? `<p class="vax-print__previous">Строка в редакции приказа № ${escapeHtml(row.amendedBy)}.</p>`
    : '';
  return `<tr class="vax-print__row">${numberCell(row)}<td class="vax-print__cell">${escapeHtml(
    row.vaccine,
  )}</td><td class="vax-print__cell">${row.categories.map(blockHtml).join('')}${amended}</td></tr>`;
}

function appendixTable(
  calendar: VaccinationCalendar,
  heading: string,
  columns: readonly string[],
  rows: string,
): string {
  return `<table class="vax-print__table"><colgroup><col style="width:12mm" /><col style="width:${
    columns[1]?.startsWith('Категории') ? '82mm' : '88mm'
  }" /><col /></colgroup><thead>${runningHead(calendar, heading, 3)}${columnHeads(
    columns,
  )}</thead><tbody>${rows}</tbody></table>`;
}

function summaryGridHtml(calendar: VaccinationCalendar): string {
  const grid = buildSummaryGrid(calendar);
  const head = `<tr><th class="vax-print__head-cell vax-print__infection">Инфекция</th>${grid.columns
    .map((column) => `<th class="vax-print__head-cell">${escapeHtml(column.label)}</th>`)
    .join('')}</tr>`;
  const body = grid.rows
    .map(
      (row) =>
        `<tr class="vax-print__row"><th class="vax-print__cell vax-print__infection" scope="row">${escapeHtml(
          row.infection,
        )}</th>${grid.columns
          .map((column) => {
            const doses = row.cells.get(column.rowId) ?? [];
            return `<td class="vax-print__cell">${doses
              .map(
                (dose) =>
                  `<span class="vax-print__dose">${escapeHtml(dose.label)}${dose.qualifier ? '*' : ''}</span>`,
              )
              .join('')}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<h2 class="vax-print__heading">Сводка национального календаря по возрасту</h2>
<p class="vax-print__legend">Составлена по строкам 1–15 приложения № 1; не является текстом приказа. V — вакцинация, RV — ревакцинация, цифра — номер в названии прививки; * — «группы риска». Прививки по категориям (строки 16–19) в сводку не входят: см. таблицу приложения № 1.</p>
<table class="vax-print__grid"><colgroup><col style="width:40mm" />${grid.columns.map(() => '<col />').join('')}</colgroup><thead>${runningHead(calendar, 'Сводка', grid.columns.length + 1)}${head}</thead><tbody>${body}</tbody></table>`;
}

function procedureHtml(items: readonly ProcedureItem[]): string {
  const footnotes: string[] = [];
  const paragraphs = items
    .map((item) => {
      const mark = item.footnote ? `<sup>${item.footnote.number}</sup>` : '';
      if (item.footnote) {
        footnotes.push(
          `<p class="vax-print__footnote"><sup>${item.footnote.number}</sup> ${escapeHtml(item.footnote.text)}</p>`,
        );
      }
      const amended = item.amendedBy
        ? ` <em>(в редакции приказа № ${escapeHtml(item.amendedBy)})</em>`
        : '';
      return `<div class="vax-print__procedure">${item.blocks
        .map(
          (block, index) =>
            `<p class="vax-print__block">${index === 0 ? `${escapeHtml(item.number)}. ` : ''}${escapeHtml(
              block,
            )}${index === item.blocks.length - 1 ? `${mark}${amended}` : ''}</p>`,
        )
        .join('')}</div>`;
    })
    .join('');
  return `${paragraphs}${footnotes.length > 0 ? `<div class="vax-print__footnotes">${footnotes.join('')}</div>` : ''}`;
}

/** The whole print: Appendix 1, the summary grid, Appendix 2, Appendix 3 and the source lines. */
export function renderVaccinationPrintHtml(
  calendar: VaccinationCalendar,
  printedOn: string,
): string {
  const national = appendixTable(
    calendar,
    `Приложение № 1. ${calendar.national.title}`,
    calendar.national.columns,
    calendar.national.rows.map(nationalRowHtml).join(''),
  );
  const epidemic = appendixTable(
    calendar,
    `Приложение № 2. ${calendar.epidemic.title}`,
    calendar.epidemic.columns,
    calendar.epidemic.rows.map(epidemicRowHtml).join(''),
  );
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(VACCINATION_PRINT_TITLE)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body class="vax-print">
<header>
<h1 class="vax-print__title">${escapeHtml(calendar.title)}</h1>
<p class="vax-print__edition">${escapeHtml(calendar.edition.editionLine)}</p>
<p class="vax-print__meta">${escapeHtml(calendar.edition.label)}. В силу с ${escapeHtml(
    displayIsoDate(calendar.edition.inForceFrom),
  )}, действует до ${escapeHtml(displayIsoDate(calendar.edition.validUntil))}. Проверено на портале ${escapeHtml(
    displayIsoDate(calendar.edition.checkedOn),
  )}.</p>
</header>
<section class="vax-print__section" id="appendix-1">${national}</section>
<section class="vax-print__section vax-print__section--page" id="summary">${summaryGridHtml(calendar)}</section>
<section class="vax-print__section vax-print__section--page" id="appendix-2">${epidemic}</section>
<section class="vax-print__section vax-print__section--page" id="appendix-3">
<h2 class="vax-print__heading">Приложение № 3. ${escapeHtml(calendar.procedure.title)}</h2>
${procedureHtml(calendar.procedure.items)}
</section>
<footer class="vax-print__footer">
<p>${sourceLine(calendar)}</p>
<p>Таблицы приложений № 1–3 переписаны с официальных сканов вручную и сверены с распознанным текстом; клиническая проверка врачом не проводилась. «PDF стр.» — страница официального файла. Решение о вакцинации принимает врач по действующему приказу и инструкции к вакцине.</p>
<p>Распечатано из MiniMed ${escapeHtml(displayIsoDate(printedOn))}.</p>
</footer>
</body>
</html>`;
}
