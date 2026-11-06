import * as QRCode from 'qrcode';
import { assessmentChartPrintSvg } from '@/features/assessments/assessment-chart-print';
import {
  formatAssessmentRecord,
  formatBlankAssessment,
  sectionHeadingBefore,
} from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentImage,
  AssessmentRecord,
  AssessmentResultTable,
} from '@/features/assessments/assessment-types';
import {
  SCORE_SCALE_PRINT_CSS,
  scoreScalePrintHtml,
} from '@/features/calculators/score-scale-print';
import { PrintManager } from '@/features/printing/print-manager';
import { MINIMED_WEB_APP_URL } from '../../../../../release';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function removeLeadingTitle(title: string, text: string): string {
  const prefix = `${title}\n`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function printableAssessmentText(text: string, noteTitle = ''): string {
  const linkedTitle = noteTitle.trim();
  return text
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('Ограничение:') &&
        !line.startsWith('Версия:') &&
        !(linkedTitle && line.startsWith('Пациент / участник:')),
    )
    .map((line) =>
      linkedTitle && (line.startsWith('Дата:') || line.startsWith('Дата записи:'))
        ? `${line} ⋅ ${linkedTitle}`
        : line,
    )
    .join('\n')
    .trimEnd();
}

function renderQrCode(value: string): string {
  const qrCode = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const { size } = qrCode.modules;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (qrCode.modules.get(row, column)) path += `M${column} ${row}h1v1h-1z`;
    }
  }
  return `<svg class="footer-qr" viewBox="-4 -4 ${size + 8} ${size + 8}" role="img" aria-label="QR-код страницы" shape-rendering="crispEdges"><path d="${path}" /></svg>`;
}

export type PrintOrientation = 'portrait' | 'landscape';

function printableHtml(
  title: string,
  text: string,
  pageLink: string,
  images: readonly AssessmentImage[] = [],
  extraHtml = '',
  orientation: PrintOrientation = 'portrait',
  /**
   * A result reads result → chart → questions: `text` before `extraHtml` and this after it. Left
   * undefined, the page keeps its old order (images, `extraHtml`, `text`).
   */
  trailingText?: string,
): string {
  const lines = (value: string): string =>
    escapeHtml(value)
      .split('\n')
      .map((line) => (line ? `<div>${line}</div>` : '<br />'))
      .join('');
  const paragraphs = lines(text);
  const imageGrid = images.length
    ? `<div class="images">${images
        .map(
          (image) =>
            `<figure class="image"><img src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(image.alt)}" /><figcaption>${escapeHtml(image.alt)}</figcaption></figure>`,
        )
        .join('')}</div>`
    : '';
  const escapedPageLink = escapeHtml(pageLink);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --print-page-margin: 9mm;
      --print-border-width: 1px;
      --print-ink-color: CanvasText;
      --print-rule-color: GrayText;
      --print-title-size: 15pt;
      --print-body-size: 9.5pt;
      --print-footer-size: 6.5pt;
      --print-leading: 1.18;
      --print-title-gap: 3mm;
      --print-footer-gap: 4mm;
      --print-footer-padding: 2mm;
      --print-inline-gap: 1.5mm;
      --print-qr-size: 10mm;
    }
    @page { size: A4 ${orientation}; margin: var(--print-page-margin); }
    * { box-sizing: border-box; }
    html { background: #fff; color-scheme: light; }
    body { margin: 0; padding: 0 4mm; font-family: system-ui, -apple-system, sans-serif; color: var(--print-ink-color); font-size: var(--print-body-size); line-height: var(--print-leading); }
    /* The preview draws the sheet with the printer's margins, so it shows what prints. */
    @media screen { body { padding: var(--print-page-margin) calc(var(--print-page-margin) + 4mm); } }
    h1 { font-size: var(--print-title-size); margin: 0 0 var(--print-title-gap); }
    .document { white-space: pre-wrap; font-size: var(--print-body-size); }
    .document div { break-inside: avoid; }
    .images { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3mm; margin: 4mm 0; }
    .image { break-inside: avoid; margin: 0; }
    .image img { display: block; width: 100%; max-height: 78mm; object-fit: contain; border: 1px solid var(--print-rule-color); }
    .image figcaption { margin-top: 1mm; font-size: var(--print-footer-size); }
    ${SCORE_SCALE_PRINT_CSS}
    .schema-chart-print { max-width: ${orientation === 'landscape' ? '120mm' : '145mm'}; margin: 0 auto 4mm; break-inside: avoid; }
    .schema-chart-print__svg { display: block; width: 100%; height: auto; color: #17201c; }
    .schema-chart-print__field { fill: #fff; stroke: #84968d; stroke-width: 1; }
    .schema-chart-print__ring { fill: none; stroke: #b7c4bd; stroke-width: 1; stroke-dasharray: 2 4; }
    .schema-chart-print__axis { stroke: #405b4e; stroke-width: 1.4; }
    .schema-chart-print__quadrant { fill: currentColor; font-size: 14px; font-weight: 750; text-transform: uppercase; }
    .schema-chart-print__axis-label { fill: #405b4e; font-size: 11px; font-weight: 700; }
    .schema-chart-print__point-halo { fill: #d56745; opacity: 0.2; }
    .schema-chart-print__point { fill: #b84424; stroke: #fff; stroke-width: 2; }
    .schema-chart-print__point-label { fill: #8d3019; font-size: 11px; font-weight: 800; }
    .schema-chart-print__caption { margin-top: 1mm; color: #405b4e; font-size: 8.5pt; }
    .schema-chart-print--profile { max-width: ${orientation === 'landscape' ? '200mm' : '175mm'}; }
    .schema-chart-print__grid { stroke: #d5ddd8; stroke-width: 1; }
    .schema-chart-print__grid-label { fill: #405b4e; font-size: 11px; }
    .schema-chart-print__reference { fill: none; stroke-width: 1.4; stroke-dasharray: 6 5; }
    .schema-chart-print__reference--danger { stroke: #b84424; }
    .schema-chart-print__reference--warning { stroke: #b07a12; }
    .schema-chart-print__reference--neutral { stroke: #6b7b73; }
    .schema-chart-print__profile-line { fill: none; stroke: #17201c; stroke-width: 2; stroke-linejoin: round; }
    .schema-chart-print__profile-point { fill: #17201c; stroke: #fff; stroke-width: 1.5; }
    .schema-chart-print__value-label { fill: #17201c; font-size: 11px; font-weight: 700; }
    .schema-chart-print__category-label { fill: #17201c; font-size: 12px; font-weight: 700; }
    .result-table { border-collapse: collapse; margin: 0 0 4mm; font-size: var(--print-body-size); break-inside: avoid; }
    .result-table__caption { caption-side: top; text-align: left; font-weight: 700; padding-bottom: 1mm; }
    .result-table__cell { border: var(--print-border-width) solid var(--print-rule-color); padding: 0.6mm 2mm; text-align: right; }
    .result-table__cell--label { text-align: left; }
    .result-table__note { margin: -3mm 0 4mm; font-size: var(--print-footer-size); }
    .answer-grid { display: grid; grid-template-columns: repeat(${orientation === 'landscape' ? 10 : 7}, minmax(0, 1fr)); gap: 0 2mm; margin: 0 0 4mm; font-size: 8pt; }
    .answer-grid__cell { display: flex; justify-content: space-between; gap: 1mm; border-bottom: var(--print-border-width) solid var(--print-rule-color); padding: 0.3mm 0; break-inside: avoid; }
    .answer-grid__number { font-variant-numeric: tabular-nums; }
    .answer-grid__answer { font-weight: 700; }
    .answer-grid__boxes { letter-spacing: 0.4mm; white-space: nowrap; }
    .answer-sheet__title { font-size: 11pt; margin: 4mm 0 1.5mm; break-before: page; }
    .answer-sheet__legend { margin: 0 0 2mm; font-size: var(--print-footer-size); }
    .footer { display: flex; align-items: center; gap: var(--print-inline-gap); margin-top: var(--print-footer-gap); padding-top: var(--print-footer-padding); border-top: var(--print-border-width) solid var(--print-rule-color); font-size: var(--print-footer-size); line-height: 1.1; }
    .footer-link { overflow-wrap: anywhere; }
    .footer-qr { flex: 0 0 auto; width: var(--print-qr-size); height: var(--print-qr-size); fill: var(--print-ink-color); }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${imageGrid}
  ${trailingText !== undefined && text ? `<div class="document">${paragraphs}</div>` : ''}
  ${extraHtml}
  ${
    trailingText === undefined
      ? `<div class="document">${paragraphs}</div>`
      : trailingText
        ? `<div class="document">${lines(trailingText)}</div>`
        : ''
  }
  <footer class="footer">
    <span>MiniMed</span>
    <span aria-hidden="true">⋅</span>
    <a class="footer-link" href="${escapedPageLink}">${escapedPageLink}</a>
    <span aria-hidden="true">⋅</span>
    ${renderQrCode(pageLink)}
  </footer>
</body>
</html>`;
}

export function printText(
  title: string,
  text: string,
  images: readonly AssessmentImage[] = [],
  extraHtml = '',
): boolean {
  return PrintManager.html(
    printableHtml(title, text, MINIMED_WEB_APP_URL, images, extraHtml),
    title,
  );
}

export function printBlankAssessment(definition: AssessmentDefinition): boolean {
  const text = formatBlankAssessment(definition);
  const prefix = `${definition.title}\n${definition.description}\n`;
  const body = printableAssessmentText(
    text.startsWith(prefix)
      ? text.slice(prefix.length)
      : removeLeadingTitle(definition.title, text),
  );
  const images = [
    ...(definition.images ?? []),
    ...definition.questions.flatMap((question) => question.images ?? []),
  ];
  if (!definition.answerSheet) return printText(definition.title, body, images);
  // The questions first, then the answer sheet on a page of its own.
  return PrintManager.html(
    printableHtml(
      definition.title,
      body,
      MINIMED_WEB_APP_URL,
      images,
      blankAnswerSheetHtml(definition),
      'portrait',
      '',
    ),
    definition.title,
  );
}

/** The declared tables of a result as printed HTML tables (escaped data). */
function resultTablesHtml(tables: readonly AssessmentResultTable[]): string {
  const cell = (value: number | null): string =>
    value === null ? '—' : String(Math.round(value * 10) / 10).replace('.', ',');
  return tables
    .map(
      (
        table,
      ) => `<table class="result-table"><caption class="result-table__caption">${escapeHtml(table.title)}</caption>
<thead><tr><th class="result-table__cell result-table__cell--label"></th>${table.columns
        .map((column) => `<th class="result-table__cell">${escapeHtml(column)}</th>`)
        .join('')}</tr></thead>
<tbody>${table.rows
        .map(
          (row) =>
            `<tr><th class="result-table__cell result-table__cell--label">${escapeHtml(row.label)}</th>${row.cells
              .map((value) => `<td class="result-table__cell">${cell(value)}</td>`)
              .join('')}</tr>`,
        )
        .join(
          '',
        )}</tbody></table>${table.caption ? `<p class="result-table__note">${escapeHtml(table.caption)}</p>` : ''}`,
    )
    .join('');
}

/**
 * The answers alone as a compact grid (number and answer), so a long questionnaire's answer sheet
 * takes a page or two instead of a line per question.
 */
function answerGridHtml(definition: AssessmentDefinition, answers: AssessmentAnswers): string {
  return `<div class="answer-grid" aria-label="Ответы">${definition.questions
    .map((question, index) => {
      const choices = question.responseOptions ?? definition.responseOptions;
      const option = choices.find((candidate) => candidate.value === answers[question.id]);
      const label = option ? (option.shortLabel ?? option.label) : '—';
      return `<span class="answer-grid__cell"><span class="answer-grid__number">${index + 1}</span><span class="answer-grid__answer">${escapeHtml(label)}</span></span>`;
    })
    .join('')}</div>`;
}

/** An empty answer sheet: every question number with a box per answer, filled in by hand. */
function blankAnswerSheetHtml(definition: AssessmentDefinition): string {
  const legend = definition.responseOptions
    .map(
      (option) => `${escapeHtml(option.shortLabel ?? option.label)} — ${escapeHtml(option.label)}`,
    )
    .join('; ');
  return `<h2 class="answer-sheet__title">Бланк ответов</h2><p class="answer-sheet__legend">${legend}</p><div class="answer-grid">${definition.questions
    .map((question, index) => {
      const choices = question.responseOptions ?? definition.responseOptions;
      return `<span class="answer-grid__cell"><span class="answer-grid__number">${index + 1}</span><span class="answer-grid__boxes">${choices
        .map((option) => `${escapeHtml(option.shortLabel ?? String(option.value))}□`)
        .join(' ')}</span></span>`;
    })
    .join('')}</div>`;
}

/** What a printed result holds (owner 2026-11-06: the doctor chooses, and the preview shows it). */
export interface AssessmentPrintOptions {
  readonly orientation: PrintOrientation;
  readonly questions: boolean;
  readonly answers: boolean;
  readonly results: boolean;
  readonly chart: boolean;
}

export const DEFAULT_ASSESSMENT_PRINT: AssessmentPrintOptions = {
  orientation: 'portrait',
  questions: false,
  answers: false,
  results: true,
  chart: true,
};

/** The printed page of a result, built from escaped data: shown in the preview and printed as is. */
export function assessmentRecordPrintHtml(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
  noteTitle: string,
  options: AssessmentPrintOptions,
): string {
  const completed = record.kind === 'completed' ? record : undefined;
  const questionLines =
    completed && (options.questions || options.answers)
      ? [
          '',
          options.questions ? (options.answers ? 'Вопросы и ответы:' : 'Вопросы:') : 'Ответы:',
          ...definition.questions.flatMap((question, index) => {
            const answer = completed.answers[question.id];
            const choices = question.responseOptions ?? definition.responseOptions;
            const answerLabel =
              choices.find((option) => option.value === answer)?.label ??
              String(answer ?? 'не указан');
            const heading = options.questions ? sectionHeadingBefore(definition, index) : undefined;
            if (!options.questions) return [`${index + 1}. ${answerLabel}`];
            return [
              ...(heading ? [heading.title] : []),
              `${index + 1}. ${question.prompt}`,
              ...(options.answers ? [`   Ответ: ${answerLabel}`] : []),
            ];
          }),
        ]
      : [];
  const resultText = options.results
    ? printableAssessmentText(
        removeLeadingTitle(
          definition.title,
          formatAssessmentRecord(definition, record, { tablesAsText: false }),
        ),
        noteTitle,
      )
    : '';
  const charts =
    completed && options.chart
      ? [
          ...(completed.result.scales ?? []).map((scale) => scoreScalePrintHtml(scale)),
          ...(completed.result.visuals ?? []).map((visual) => assessmentChartPrintSvg(visual)),
        ].join('')
      : '';
  const tables =
    completed && options.results ? resultTablesHtml(completed.result.tables ?? []) : '';
  // The answers alone print as a grid; with the questions they stay under each question.
  const grid =
    completed && options.answers && !options.questions
      ? `<h2 class="answer-sheet__title">Ответы</h2>${answerGridHtml(definition, completed.answers)}`
      : '';
  const questionText = (options.questions ? questionLines.join('\n') : '').trim();
  return printableHtml(
    definition.title,
    resultText,
    MINIMED_WEB_APP_URL,
    [],
    `${tables}${charts}${grid}`,
    options.orientation,
    questionText,
  );
}

export function printAssessmentRecord(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
  noteTitle = '',
  includeQuestions = false,
): boolean {
  return PrintManager.html(
    assessmentRecordPrintHtml(definition, record, noteTitle, {
      ...DEFAULT_ASSESSMENT_PRINT,
      questions: includeQuestions,
      answers: includeQuestions,
    }),
    definition.title,
  );
}

/** Prints a page built by {@link assessmentRecordPrintHtml}. */
export function printAssessmentHtml(html: string, title: string): boolean {
  return PrintManager.html(html, title);
}

export async function shareAssessmentRecord(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
): Promise<'shared' | 'copied'> {
  const text = formatAssessmentRecord(definition, record);
  if ('share' in navigator && typeof navigator.share === 'function') {
    await navigator.share({ title: definition.title, text });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
