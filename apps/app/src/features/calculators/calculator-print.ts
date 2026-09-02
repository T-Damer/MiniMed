import { findCalculator } from '@/features/calculators/calculator-registry';
import {
  PEDIATRIC_FEEDING_PLAN_ID,
  parsePediatricFeedingPlan,
} from '@/features/calculators/pediatric-feeding-plan';
import { PrintManager } from '@/features/printing/print-manager';
import type { CalculationRecord } from '@/state/calculation-history';
import { MINIMED_WEB_APP_URL } from '../../../../../release';

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

export function formatCalculationRecord(record: CalculationRecord, noteTitle = ''): string {
  if (record.calculatorId === PEDIATRIC_FEEDING_PLAN_ID && 'textValues' in record.result) {
    const plan = parsePediatricFeedingPlan(record.result.textValues);
    return [
      'Рацион ребёнка на один день',
      record.subjectLabel ? `Ребёнок: ${record.subjectLabel}` : '',
      plan.details,
      `Частота: ${plan.frequency}`,
      `За сутки: ${plan.dailyVolume}; ${plan.dailyCalories}`,
      plan.allergyPlan ?? '',
      '',
      ...plan.meals.map((meal) => `${meal.time} — ${meal.food}; ${meal.volume}; ${meal.calories}`),
      ...(plan.calendar.length > 0
        ? [
            '',
            'Календарь введения прикорма',
            ...plan.calendar.map((item) => `${item.day}: ${item.instruction}`),
          ]
        : []),
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }
  const definition = findCalculator(record.calculatorId);
  const title = definition?.title ?? record.calculatorId;
  const linkedTitle = noteTitle.trim();
  const outputs =
    'textValues' in record.result || 'values' in record.result
      ? calculationRecordOutputs(record)
          .map((item) => `${item.label}: ${item.display}`)
          .join('\n')
      : (calculationRecordOutputs(record)[0]?.display ?? '');
  const warnings = record.result.warnings.map((warning) => `- ${warning.message}`).join('\n');
  const subject =
    !linkedTitle && record.subjectLabel ? `Пациент / случай: ${record.subjectLabel}\n` : '';
  const date = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(record.createdAt));
  return [
    title,
    subject,
    `Дата: ${date}${linkedTitle ? ` ⋅ ${linkedTitle}` : ''}`,
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

function feedingPlanPrintHtml(record: CalculationRecord, noteTitle: string): string {
  const textValues = 'textValues' in record.result ? record.result.textValues : [];
  const plan = parsePediatricFeedingPlan(textValues);
  const rows = plan.meals
    .map(
      (meal) => `<tr class="feeding-sheet__meal">
<th class="feeding-sheet__cell feeding-sheet__cell--time" scope="row">${escapeHtml(meal.time)}</th>
<td class="feeding-sheet__cell">${escapeHtml(meal.food)}</td>
<td class="feeding-sheet__cell feeding-sheet__cell--number">${escapeHtml(meal.volume)}</td>
<td class="feeding-sheet__cell feeding-sheet__cell--number">${escapeHtml(meal.calories)}</td>
</tr>`,
    )
    .join('');
  const calendar = plan.calendar
    .map(
      (item) =>
        `<li class="feeding-sheet__calendar-item"><b>${escapeHtml(item.day)}</b> ${escapeHtml(item.instruction)}</li>`,
    )
    .join('');
  const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(
    new Date(record.createdAt),
  );
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Рацион ребёнка на день</title>
<style>
@page{size:A4 portrait;margin:9mm}
*{box-sizing:border-box}
body{margin:0;color:#17201c;background:#fff;font:8.5pt/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums}
.feeding-sheet{position:relative;height:279mm;overflow:hidden;padding:0 0 17mm}
.feeding-sheet__kicker{margin:0 0 1mm;color:#3f6955;font-size:7pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.feeding-sheet__title{margin:0;font:700 19pt/1.05 Georgia,serif}
.feeding-sheet__meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1mm 6mm;margin:3mm 0;padding:2.5mm;border:1px solid #c8d6cf;border-radius:2mm;background:#f5f8f6}
.feeding-sheet__meta-item{margin:0}
.feeding-sheet__meta-label{display:block;color:#607068;font-size:6.5pt;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
.feeding-sheet__guide,.feeding-sheet__allergy{margin:0 0 2.5mm;padding:2mm 2.5mm;border-left:1.2mm solid #78a88f;border-radius:1mm;background:#edf5f1;font-weight:700}
.feeding-sheet__allergy{border-left-color:#bc7b38;background:#fff5e9}
.feeding-sheet__summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2mm;margin:0 0 2.5mm}
.feeding-sheet__summary-item{margin:0;padding:2mm;border:1px solid #c8d6cf;border-radius:1.5mm}
.feeding-sheet__summary-label{display:block;color:#607068;font-size:6.5pt;font-weight:800;text-transform:uppercase}
.feeding-sheet__summary-value{font-weight:800}
.feeding-sheet__table{width:100%;border-collapse:collapse;border:1px solid #aebeb6}
.feeding-sheet__meal{break-inside:avoid}
.feeding-sheet__cell{padding:2mm;border:1px solid #ccd6d1;text-align:left;vertical-align:top}
.feeding-sheet__cell--time{width:23mm;color:#315b47;background:#f6f8f7}
.feeding-sheet__cell--number{width:24mm;white-space:nowrap}
.feeding-sheet__calendar-title{margin:3mm 0 1mm;font:700 11pt/1.1 Georgia,serif}
.feeding-sheet__calendar-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1mm 5mm;margin:0;padding-left:5mm;font-size:7.2pt}
.feeding-sheet__calendar-item{break-inside:avoid}
.feeding-sheet__emoji{position:absolute;right:0;bottom:0;font-size:15mm;line-height:1;opacity:.18}
</style>
</head>
<body>
<main class="feeding-sheet">
<p class="feeding-sheet__kicker">План на один день</p>
<h1 class="feeding-sheet__title">Рацион ребёнка</h1>
<section class="feeding-sheet__meta" aria-label="Данные рациона">
<p class="feeding-sheet__meta-item"><span class="feeding-sheet__meta-label">Ребёнок</span>${escapeHtml(record.subjectLabel || 'Имя не указано')}</p>
<p class="feeding-sheet__meta-item"><span class="feeding-sheet__meta-label">Дата</span>${escapeHtml(date)}</p>
<p class="feeding-sheet__meta-item"><span class="feeding-sheet__meta-label">Возраст и режим</span>${escapeHtml(plan.details)}</p>
${noteTitle.trim() ? `<p class="feeding-sheet__meta-item"><span class="feeding-sheet__meta-label">Карточка</span>${escapeHtml(noteTitle.trim())}</p>` : ''}
</section>
<p class="feeding-sheet__guide">${escapeHtml(plan.guide)}</p>
<section class="feeding-sheet__summary" aria-label="Итоги за сутки">
<p class="feeding-sheet__summary-item"><span class="feeding-sheet__summary-label">Частота</span><span class="feeding-sheet__summary-value">${escapeHtml(plan.frequency)}</span></p>
<p class="feeding-sheet__summary-item"><span class="feeding-sheet__summary-label">Объём</span><span class="feeding-sheet__summary-value">${escapeHtml(plan.dailyVolume)}</span></p>
<p class="feeding-sheet__summary-item"><span class="feeding-sheet__summary-label">Калорийность</span><span class="feeding-sheet__summary-value">${escapeHtml(plan.dailyCalories)}</span></p>
</section>
${plan.allergyPlan ? `<p class="feeding-sheet__allergy">${escapeHtml(plan.allergyPlan)}</p>` : ''}
<table class="feeding-sheet__table">
<thead><tr><th class="feeding-sheet__cell feeding-sheet__cell--time" scope="col">Время</th><th class="feeding-sheet__cell" scope="col">Что предложить</th><th class="feeding-sheet__cell feeding-sheet__cell--number" scope="col">Объём</th><th class="feeding-sheet__cell feeding-sheet__cell--number" scope="col">Ккал</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${calendar ? `<h2 class="feeding-sheet__calendar-title">Календарь введения прикорма</h2><ol class="feeding-sheet__calendar-list">${calendar}</ol>` : ''}
<span class="feeding-sheet__emoji" aria-hidden="true">👩‍🍼</span>
</main>
</body>
</html>`;
}

export function printCalculationRecord(record: CalculationRecord, noteTitle = ''): boolean {
  const title = findCalculator(record.calculatorId)?.title ?? 'Расчёт MiniMed';
  if (record.calculatorId === PEDIATRIC_FEEDING_PLAN_ID) {
    return PrintManager.html(feedingPlanPrintHtml(record, noteTitle), title);
  }
  const text = formatCalculationRecord(record, noteTitle);
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
<small>MiniMed · <a href="${MINIMED_WEB_APP_URL}">${MINIMED_WEB_APP_URL}</a></small>
</body>
</html>`;
  return PrintManager.html(html, title);
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
