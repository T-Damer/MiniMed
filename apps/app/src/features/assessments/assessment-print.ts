import * as QRCode from 'qrcode';
import { assessmentChartPrintSvg } from '@/features/assessments/assessment-chart-print';
import {
  formatAssessmentRecord,
  formatBlankAssessment,
} from '@/features/assessments/assessment-engine';
import type {
  AssessmentDefinition,
  AssessmentImage,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
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

function printableHtml(
  title: string,
  text: string,
  pageLink: string,
  images: readonly AssessmentImage[] = [],
  extraHtml = '',
): string {
  const paragraphs = escapeHtml(text)
    .split('\n')
    .map((line) => (line ? `<div>${line}</div>` : '<br />'))
    .join('');
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
      --print-body-size: 8.5pt;
      --print-footer-size: 6.5pt;
      --print-leading: 1.18;
      --print-title-gap: 3mm;
      --print-footer-gap: 4mm;
      --print-footer-padding: 2mm;
      --print-inline-gap: 1.5mm;
      --print-qr-size: 10mm;
    }
    @page { size: A4; margin: var(--print-page-margin); }
    * { box-sizing: border-box; }
    body { max-width: 190mm; margin: 0 auto; padding: 0 4mm; font-family: system-ui, -apple-system, sans-serif; color: var(--print-ink-color); font-size: var(--print-body-size); line-height: var(--print-leading); }
    h1 { font-size: var(--print-title-size); margin: 0 0 var(--print-title-gap); }
    .document { white-space: pre-wrap; font-size: var(--print-body-size); }
    .document div { break-inside: avoid; }
    .images { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3mm; margin: 4mm 0; }
    .image { break-inside: avoid; margin: 0; }
    .image img { display: block; width: 100%; max-height: 78mm; object-fit: contain; border: 1px solid var(--print-rule-color); }
    .image figcaption { margin-top: 1mm; font-size: var(--print-footer-size); }
    .schema-chart-print { max-width: 145mm; margin: 0 auto 4mm; break-inside: avoid; }
    .schema-chart-print__svg { display: block; width: 100%; height: auto; color: #17201c; }
    .schema-chart-print__field { fill: #fff; stroke: #84968d; stroke-width: 1; }
    .schema-chart-print__ring { fill: none; stroke: #b7c4bd; stroke-width: 1; stroke-dasharray: 2 4; }
    .schema-chart-print__axis { stroke: #405b4e; stroke-width: 1.4; }
    .schema-chart-print__quadrant { fill: currentColor; font-size: 14px; font-weight: 750; text-transform: uppercase; }
    .schema-chart-print__axis-label { fill: #405b4e; font-size: 11px; font-weight: 700; }
    .schema-chart-print__point-halo { fill: #d56745; opacity: 0.2; }
    .schema-chart-print__point { fill: #b84424; stroke: #fff; stroke-width: 2; }
    .schema-chart-print__point-label { fill: #8d3019; font-size: 11px; font-weight: 800; }
    .schema-chart-print__caption { margin-top: 1mm; color: #405b4e; font-size: 7pt; }
    .footer { display: flex; align-items: center; gap: var(--print-inline-gap); margin-top: var(--print-footer-gap); padding-top: var(--print-footer-padding); border-top: var(--print-border-width) solid var(--print-rule-color); font-size: var(--print-footer-size); line-height: 1.1; }
    .footer-link { overflow-wrap: anywhere; }
    .footer-qr { flex: 0 0 auto; width: var(--print-qr-size); height: var(--print-qr-size); fill: var(--print-ink-color); }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${imageGrid}
  ${extraHtml}
  <div class="document">${paragraphs}</div>
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
  return printText(
    definition.title,
    printableAssessmentText(
      text.startsWith(prefix)
        ? text.slice(prefix.length)
        : removeLeadingTitle(definition.title, text),
    ),
    [
      ...(definition.images ?? []),
      ...definition.questions.flatMap((question) => question.images ?? []),
    ],
  );
}

export function printAssessmentRecord(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
  noteTitle = '',
  includeQuestions = false,
): boolean {
  const questions =
    includeQuestions && record.kind === 'completed'
      ? [
          '',
          'Вопросы и ответы:',
          ...definition.questions.flatMap((question, index) => {
            const answer = record.answers[question.id];
            const options = question.responseOptions ?? definition.responseOptions;
            const answerLabel = options.find((option) => option.value === answer)?.label;
            return [
              `${index + 1}. ${question.prompt}`,
              `   Ответ: ${answerLabel ?? String(answer ?? 'не указан')}`,
            ];
          }),
        ].join('\n')
      : '';
  const charts =
    record.kind === 'completed'
      ? (record.result.visuals ?? []).map(assessmentChartPrintSvg).join('')
      : '';
  return printText(
    definition.title,
    [
      printableAssessmentText(
        removeLeadingTitle(definition.title, formatAssessmentRecord(definition, record)),
        noteTitle,
      ),
      questions,
    ]
      .filter(Boolean)
      .join('\n'),
    [],
    charts,
  );
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
