import { findCalculator } from '@/features/calculators/calculator-registry';
import { printHtmlInNativeShell } from '@/features/printing/native-print';
import type { CalculationRecord } from '@/state/calculation-history';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatCalculatorNumber(value: number, precision: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  }).format(value);
}

export function calculationRecordOutputs(
  record: CalculationRecord,
): readonly { readonly label: string; readonly display: string }[] {
  const result = record.result;
  if ('textValues' in result) {
    return result.textValues.map((item) => ({ label: item.label, display: item.text }));
  }
  if ('value' in result) {
    return [
      {
        label: 'Результат',
        display: `${formatCalculatorNumber(result.value, result.displayPrecision)} ${result.unit}`,
      },
    ];
  }
  return result.values.map((item) => ({
    label: item.label,
    display: `${formatCalculatorNumber(item.value, item.displayPrecision)} ${item.unit}`,
  }));
}

export function formatCalculationRecord(record: CalculationRecord): string {
  const definition = findCalculator(record.calculatorId);
  const title = definition?.title ?? record.calculatorId;
  const outputs =
    'textValues' in record.result || 'values' in record.result
      ? calculationRecordOutputs(record)
          .map((item) => `${item.label}: ${item.display}`)
          .join('\n')
      : (calculationRecordOutputs(record)[0]?.display ?? '');
  const warnings = record.result.warnings.map((warning) => `- ${warning.message}`).join('\n');
  const subject = record.subjectLabel ? `Пациент / случай: ${record.subjectLabel}\n` : '';
  return [
    title,
    subject,
    `Дата: ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.createdAt))}`,
    `Входные данные: ${record.inputSummary}`,
    `Формула: ${record.result.formula}`,
    '',
    outputs,
    warnings ? `\nОграничения:\n${warnings}` : '',
    '\nРезультат является расчётной поддержкой и должен интерпретироваться в клиническом контексте.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function printCalculationRecord(record: CalculationRecord): void {
  const text = formatCalculationRecord(record);
  const title = findCalculator(record.calculatorId)?.title ?? 'Расчёт MiniMed';
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.45;color:#111}
pre{white-space:pre-wrap;font:inherit;border:1px solid #bbb;border-radius:12px;padding:20px}
small{color:#555}
@media print{body{margin:0 auto;max-width:190mm;padding:0 4mm}button{display:none}}
</style>
</head>
<body>
<pre>${escapeHtml(text)}</pre>
<small>MiniMed · локальный расчёт</small>
<script>window.addEventListener('afterprint',()=>window.close());window.addEventListener('load',()=>window.print())</script>
</body>
</html>`;
  if (printHtmlInNativeShell(html, title)) return;
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('Не удалось открыть окно печати.');
  popup.document.write(html);
  popup.document.close();
}

export async function shareCalculationRecord(
  record: CalculationRecord,
): Promise<'shared' | 'copied'> {
  const text = formatCalculationRecord(record);
  if (navigator.share) {
    await navigator.share({
      title: findCalculator(record.calculatorId)?.title ?? 'Расчёт MiniMed',
      text,
    });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
