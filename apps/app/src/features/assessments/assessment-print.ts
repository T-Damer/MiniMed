import * as QRCode from 'qrcode';

import {
  formatAssessmentRecord,
  formatBlankAssessment,
} from '@/features/assessments/assessment-engine';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
import { printHtmlInNativeShell } from '@/features/printing/native-print';

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

function printableHtml(title: string, text: string, pageLink: string): string {
  const paragraphs = escapeHtml(text)
    .split('\n')
    .map((line) => (line ? `<div>${line}</div>` : '<br />'))
    .join('');
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
    .footer { display: flex; align-items: center; gap: var(--print-inline-gap); margin-top: var(--print-footer-gap); padding-top: var(--print-footer-padding); border-top: var(--print-border-width) solid var(--print-rule-color); font-size: var(--print-footer-size); line-height: 1.1; }
    .footer-link { overflow-wrap: anywhere; }
    .footer-qr { flex: 0 0 auto; width: var(--print-qr-size); height: var(--print-qr-size); fill: var(--print-ink-color); }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
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

export function printText(title: string, text: string): boolean {
  const html = printableHtml(title, text, window.location.href);
  if (printHtmlInNativeShell(html, title)) return true;
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.onafterprint = () => popup.close();
  window.setTimeout(() => {
    popup.focus();
    popup.print();
  }, 50);
  return true;
}

export function printBlankAssessment(definition: AssessmentDefinition): boolean {
  const text = formatBlankAssessment(definition);
  const prefix = `${definition.title}\n${definition.description}\n`;
  return printText(
    definition.title,
    text.startsWith(prefix)
      ? text.slice(prefix.length)
      : removeLeadingTitle(definition.title, text),
  );
}

export function printAssessmentRecord(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
): boolean {
  return printText(
    definition.title,
    removeLeadingTitle(definition.title, formatAssessmentRecord(definition, record)),
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
