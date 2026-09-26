import {
  type DiaryEntry,
  type DiaryField,
  type DiaryInvitation,
  describeDiaryValue,
} from '@/features/diary/diary-model';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function columnTitle(field: DiaryField): string {
  const unit = field.unit ? `, ${field.unit}` : '';
  const options =
    (field.type === 'choice' || field.type === 'multi') && field.options
      ? `<small>${escapeHtml(field.options.join(' / '))}</small>`
      : field.type === 'flag'
        ? '<small>да / нет</small>'
        : '';
  return `${escapeHtml(field.label + unit)}${options}`;
}

function cell(invitation: DiaryInvitation, field: DiaryField, entry: DiaryEntry): string {
  const value = entry.values[field.id];
  if (value === undefined) return '';
  if (typeof value === 'number') return escapeHtml(value.toLocaleString('ru-RU'));
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'string') return escapeHtml(value);
  if (Array.isArray(value)) return escapeHtml(value.join(', '));
  return escapeHtml(describeDiaryValue(invitation, field, value));
}

/**
 * A printable diary: the doctor's plan, then one table row per entry followed by empty rows
 * to fill in by hand. Landscape A4 so every field gets its own column.
 */
export function diaryPrintHtml(
  invitation: DiaryInvitation,
  entries: readonly DiaryEntry[] = [],
  blankRows = 20,
): string {
  const header = invitation.fields.map((field) => `<th>${columnTitle(field)}</th>`).join('');
  const filled = entries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(
          new Date(entry.at).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }),
        )}</td>${invitation.fields.map((field) => `<td>${cell(invitation, field, entry)}</td>`).join('')}<td>${escapeHtml(entry.note ?? '')}</td></tr>`,
    )
    .join('');
  const empty = Array.from(
    { length: blankRows },
    () =>
      `<tr class="blank"><td></td>${invitation.fields.map(() => '<td></td>').join('')}<td></td></tr>`,
  ).join('');
  const plan = invitation.plan?.length
    ? `<section class="plan"><h2>${escapeHtml(invitation.planTitle ?? 'Назначение врача')}</h2><ol>${invitation.plan
        .map(
          (item) =>
            `<li><strong>${escapeHtml(item.name)}</strong>${item.dose ? ` — ${escapeHtml(item.dose)}` : ''}${item.schedule ? `, ${escapeHtml(item.schedule)}` : ''}</li>`,
        )
        .join('')}</ol></section>`
    : '';
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(invitation.title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #17201c; font-size: 9.5pt; }
    h1 { margin: 0 0 2mm; font-size: 15pt; }
    h2 { margin: 3mm 0 1mm; font-size: 10.5pt; }
    .meta { margin: 0 0 1mm; color: #405b4e; }
    .plan ol { margin: 0; padding-left: 5mm; }
    table { width: 100%; margin-top: 4mm; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 0.3mm solid #84968d; padding: 1.2mm 1.5mm; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #eef2ef; font-size: 8.5pt; text-align: left; }
    th small { display: block; font-weight: 400; color: #405b4e; }
    th:first-child, td:first-child { width: 24mm; }
    tr.blank td { height: 8mm; }
    tr { break-inside: avoid; }
  </style>
</head>
<body>
  <h1>${escapeHtml(invitation.title)}</h1>
  ${invitation.doctor ? `<p class="meta">Врач: ${escapeHtml(invitation.doctor)}</p>` : ''}
  ${invitation.note ? `<p class="meta">${escapeHtml(invitation.note)}</p>` : ''}
  ${plan}
  <table>
    <thead><tr><th>Дата и время</th>${header}<th>Комментарий</th></tr></thead>
    <tbody>${filled}${empty}</tbody>
  </table>
</body>
</html>`;
}

/** Prints a standalone HTML document from a lightweight page without the app print stack. */
export function printHtmlInFrame(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = html;
  frame.addEventListener('load', () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  });
  document.body.append(frame);
}
