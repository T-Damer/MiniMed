import {
  formatAssessmentRecord,
  formatBlankAssessment,
} from '@/features/assessments/assessment-engine';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function printableHtml(title: string, text: string): string {
  const paragraphs = escapeHtml(text)
    .split('\n')
    .map((line) => (line ? `<div>${line}</div>` : '<br />'))
    .join('');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: system-ui, -apple-system, sans-serif; color: #111; line-height: 1.45; }
    h1 { font-size: 20pt; margin: 0 0 8mm; }
    .document { white-space: pre-wrap; font-size: 11pt; }
    .footer { margin-top: 10mm; padding-top: 4mm; border-top: 1px solid #bbb; font-size: 8pt; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="document">${paragraphs}</div>
  <div class="footer">Сформировано локально в MiniMed. Для сохранения выберите «Печать в PDF».</div>
</body>
</html>`;
}

export function printText(title: string, text: string): boolean {
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;
  popup.document.open();
  popup.document.write(printableHtml(title, text));
  popup.document.close();
  window.setTimeout(() => {
    popup.focus();
    popup.print();
  }, 50);
  return true;
}

export function printBlankAssessment(definition: AssessmentDefinition): boolean {
  return printText(definition.title, formatBlankAssessment(definition));
}

export function printAssessmentRecord(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
): boolean {
  return printText(definition.title, formatAssessmentRecord(definition, record));
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
