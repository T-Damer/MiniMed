/**
 * Print and share text of a comparison (CMP1): the same rows, quoted sentences and marks the screen
 * shows, with their sources, and the notice that this is a comparison of instruction texts and not
 * a clinical recommendation.
 */
import type { PrintPair } from '@/features/drug-interactions/interaction-print';
import { COMPARISON_NOTICE } from './comparison-view';

export interface PrintColumn {
  readonly name: string;
  /** The instruction read: trade name, form, kind, edition, source. */
  readonly source: string;
}

export interface PrintScalarRow {
  readonly title: string;
  /** One text per column; lines are separated by a line break. */
  readonly cells: readonly string[];
}

export interface PrintCluster {
  /** «у обоих», «у Нурофен; у других совпадения нет». */
  readonly label: string;
  /** One text per column; null where the drug does not state it. */
  readonly texts: readonly (string | null)[];
}

export interface PrintSection {
  readonly title: string;
  readonly summary: string;
  readonly clusters: readonly PrintCluster[];
  /** Columns without this section in the instruction that was read. */
  readonly missing: readonly string[];
}

export interface ComparisonPrintModel {
  readonly columns: readonly PrintColumn[];
  readonly groups: readonly {
    readonly title: string;
    readonly source: string;
    readonly rows: readonly PrintScalarRow[];
  }[];
  readonly sections: readonly PrintSection[];
  readonly interactions: readonly PrintPair[];
  readonly onlyDifferences: boolean;
  /** «ЕСКЛП (выгрузка …), ГРЛС (…)». */
  readonly registrySource: string;
}

export const COMPARISON_PRINT_TITLE = 'Сравнение препаратов: тексты инструкций';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function lines(value: string): string {
  return value
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br>');
}

const PRINT_STYLES = `
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .cmp-print { font-family: "Times New Roman", Times, serif; font-size: 10pt; line-height: 1.3; }
  .cmp-print__title { margin: 0 0 2mm; font-size: 15pt; }
  .cmp-print__notice { margin: 0 0 4mm; padding: 2mm 3mm; border: 0.3mm solid #000; font-size: 9.5pt; }
  .cmp-print__heading { margin: 5mm 0 1.5mm; font-size: 12pt; }
  .cmp-print__source { margin: 0 0 1.5mm; font-size: 8.5pt; color: #333; }
  .cmp-print__summary { margin: 0 0 1.5mm; font-size: 9pt; }
  .cmp-print__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .cmp-print__table th, .cmp-print__table td { border: 0.2mm solid #666; padding: 1.2mm 1.8mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  .cmp-print__table th { background: #eee; font-size: 9pt; }
  .cmp-print__label { width: 22mm; font-size: 8.5pt; font-weight: bold; }
  .cmp-print__missing { margin: 1mm 0 0; font-size: 8.5pt; }
  .cmp-print__row { break-inside: avoid; }
  .cmp-print__pair { margin: 0 0 3mm; break-inside: avoid-page; }
  .cmp-print__pair-title { margin: 0 0 1mm; font-size: 11pt; }
  .cmp-print__quote { margin: 0 0 1mm 4mm; padding-left: 2.5mm; border-left: 0.5mm solid #000; }
  .cmp-print__date { margin: 4mm 0 0; font-size: 8.5pt; color: #333; }
`;

function head(model: ComparisonPrintModel, firstLabel: string): string {
  return `<tr><th class="cmp-print__label">${escapeHtml(firstLabel)}</th>${model.columns
    .map((column) => `<th>${escapeHtml(column.name)}</th>`)
    .join('')}</tr>`;
}

export function renderComparisonPrintHtml(model: ComparisonPrintModel, printedOn: string): string {
  const sources = model.columns
    .map(
      (column) =>
        `<p class="cmp-print__source"><b>${escapeHtml(column.name)}</b>: ${escapeHtml(column.source)}</p>`,
    )
    .join('');
  const groups = model.groups
    .map(
      (group) => `
    <h2 class="cmp-print__heading">${escapeHtml(group.title)}</h2>
    <p class="cmp-print__source">${escapeHtml(group.source)}</p>
    <table class="cmp-print__table">${head(model, 'Параметр')}${group.rows
      .map(
        (row) =>
          `<tr class="cmp-print__row"><td class="cmp-print__label">${escapeHtml(row.title)}</td>${row.cells
            .map((cell) => `<td>${lines(cell)}</td>`)
            .join('')}</tr>`,
      )
      .join('')}</table>`,
    )
    .join('');
  const sections = model.sections
    .map(
      (section) => `
    <h2 class="cmp-print__heading">${escapeHtml(section.title)}</h2>
    ${section.summary ? `<p class="cmp-print__summary">${escapeHtml(section.summary)}</p>` : ''}
    ${section.missing.length > 0 ? `<p class="cmp-print__missing">В прочитанной инструкции нет раздела: ${escapeHtml(section.missing.join(', '))}.</p>` : ''}
    <table class="cmp-print__table">${head(model, 'Отметка')}${section.clusters
      .map(
        (cluster) =>
          `<tr class="cmp-print__row"><td class="cmp-print__label">${escapeHtml(cluster.label)}</td>${cluster.texts
            .map((text) => `<td>${text === null ? '—' : escapeHtml(text)}</td>`)
            .join('')}</tr>`,
      )
      .join('')}</table>`,
    )
    .join('');
  const interactions =
    model.interactions.length === 0
      ? ''
      : `<h2 class="cmp-print__heading">Взаимодействие между этими препаратами (предложения из инструкций)</h2>${model.interactions
          .map(
            (pair) => `
    <div class="cmp-print__pair">
      <h3 class="cmp-print__pair-title">${escapeHtml(pair.title)}</h3>
      <p class="cmp-print__summary">${escapeHtml(pair.status)}</p>
      ${pair.severity ? `<p class="cmp-print__summary">${escapeHtml(pair.severity)}</p>` : ''}
      ${pair.sides
        .map(
          (side) =>
            `<p class="cmp-print__source"><b>${escapeHtml(side.heading)}</b> ${escapeHtml(side.source)}</p>${side.quotes
              .map(
                (quote) =>
                  `<p class="cmp-print__quote"><i>${escapeHtml(quote.section)}.</i> ${escapeHtml(quote.text)}</p>`,
              )
              .join('')}`,
        )
        .join('')}
    </div>`,
          )
          .join('')}`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(COMPARISON_PRINT_TITLE)}</title><style>${PRINT_STYLES}</style></head><body><main class="cmp-print"><h1 class="cmp-print__title">Сравнение препаратов</h1><p class="cmp-print__notice">${escapeHtml(COMPARISON_NOTICE)}</p>${sources}${model.onlyDifferences ? '<p class="cmp-print__summary">Показаны только различия: пункты, одинаковые в инструкциях всех препаратов, пропущены.</p>' : ''}${groups}${sections}${interactions}<p class="cmp-print__date">${escapeHtml(model.registrySource)}. Составлено ${escapeHtml(printedOn)} в приложении MiniMed по установленным текстам инструкций.</p></main></body></html>`;
}

/** The same content as plain text, for sharing or copying. */
export function comparisonShareText(model: ComparisonPrintModel): string {
  const out: string[] = [COMPARISON_PRINT_TITLE, '', COMPARISON_NOTICE, ''];
  for (const column of model.columns) out.push(`${column.name}: ${column.source}`);
  if (model.onlyDifferences) {
    out.push('', 'Показаны только различия: одинаковые пункты пропущены.');
  }
  for (const group of model.groups) {
    out.push('', group.title.toLocaleUpperCase('ru-RU'), group.source);
    for (const row of group.rows) {
      out.push('', row.title);
      model.columns.forEach((column, position) => {
        out.push(`  ${column.name}: ${(row.cells[position] ?? '').replaceAll('\n', '; ')}`);
      });
    }
  }
  for (const section of model.sections) {
    out.push('', section.title.toLocaleUpperCase('ru-RU'));
    if (section.summary) out.push(section.summary);
    if (section.missing.length > 0) {
      out.push(`В прочитанной инструкции нет раздела: ${section.missing.join(', ')}.`);
    }
    for (const cluster of section.clusters) {
      out.push(`— [${cluster.label}]`);
      cluster.texts.forEach((text, position) => {
        if (text !== null) out.push(`    ${model.columns[position]?.name ?? ''}: ${text}`);
      });
    }
  }
  if (model.interactions.length > 0) {
    out.push('', 'ВЗАИМОДЕЙСТВИЕ МЕЖДУ ЭТИМИ ПРЕПАРАТАМИ');
    for (const pair of model.interactions) {
      out.push(pair.title, pair.status);
      if (pair.severity) out.push(pair.severity);
      for (const side of pair.sides) {
        out.push(side.heading, side.source);
        for (const quote of side.quotes) out.push(`  — [${quote.section}] ${quote.text}`);
      }
    }
  }
  out.push('', model.registrySource);
  return out.join('\n').trimEnd();
}
