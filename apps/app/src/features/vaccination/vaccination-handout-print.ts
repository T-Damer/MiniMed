import { displayIsoDate, escapeHtml } from '@/features/vaccination/vaccination-format';
import type { Handout, HandoutDose } from '@/features/vaccination/vaccination-handout';
import type { DoseStatus } from '@/features/vaccination/vaccination-status';

/** A4 portrait print of the handout for the child's mother: one page, plain words. */

export const VACCINATION_HANDOUT_TITLE = 'Прививки ребёнка';

/** The sheet is laid out at A4 portrait and scaled for previews. */
export const HANDOUT_SHEET = { width: 794, height: 1123 } as const;

const STYLES = `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .handout { padding: 10mm 12mm; font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.28; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .handout__title { margin: 0 0 2.5mm; font-size: 17pt; line-height: 1.1; }
  .handout__child { display: grid; grid-template-columns: auto 1fr auto auto; gap: 1mm 2.5mm; align-items: end; margin: 0 0 4mm; font-size: 10.5pt; }
  .handout__label { font-weight: bold; }
  .handout__value { min-height: 5.5mm; padding: 0 1mm; border-bottom: 0.25mm solid #000; }
  .handout__value--date { min-width: 36mm; }
  .handout__table { width: 100%; border-collapse: collapse; }
  .handout__head { padding: 1.2mm 1.6mm; border-bottom: 0.5mm solid #000; text-align: left; font-size: 8.5pt; font-weight: bold; }
  .handout__age { width: 25mm; padding: 1.7mm 1.6mm; border-bottom: 0.2mm solid #999; vertical-align: top; font-weight: bold; }
  .handout__when { width: 34mm; padding: 1.7mm 1.6mm; border-bottom: 0.2mm solid #999; vertical-align: top; }
  .handout__when-end { display: block; }
  .handout__doses { padding: 1.3mm 1.6mm; border-bottom: 0.2mm solid #999; vertical-align: top; }
  .handout__dose { display: grid; grid-template-columns: 3.6mm 1fr auto; gap: 0 2mm; align-items: start; padding: 0.5mm 0; }
  .handout__box { display: block; position: relative; width: 3.6mm; height: 3.6mm; margin-top: 0.2mm; border: 0.3mm solid #000; }
  .handout__box--done { background: #000; }
  .handout__box--done::after { content: ""; position: absolute; left: 1mm; top: 0.1mm; width: 1.1mm; height: 2.2mm; border: solid #fff; border-width: 0 0.45mm 0.45mm 0; transform: rotate(45deg); }
  .handout__box--planned { border-style: dashed; }
  .handout__note { white-space: nowrap; font-size: 9pt; }
  .handout__note--strong { font-weight: bold; }
  .handout__blank { display: inline-block; min-width: 24mm; border-bottom: 0.2mm solid #666; height: 3.4mm; vertical-align: bottom; }
  .handout__foot { margin: 4mm 0 0; font-size: 8pt; color: #333; }
`;

function noteHtml(dose: HandoutDose): string {
  const noted = dose.noted ? escapeHtml(dose.noted) : '';
  const blank = '<span class="handout__blank"></span>';
  const byStatus: Record<DoseStatus, string> = {
    done: `<span class="handout__note handout__note--strong">сделана${noted ? ` ${noted}` : ''}</span>`,
    planned: `<span class="handout__note">запланирована${noted ? ` ${noted}` : ''}</span>`,
    now: `<span class="handout__note handout__note--strong">пора сделать</span>`,
    overdue: `<span class="handout__note handout__note--strong">нужно сделать</span>`,
    later: blank,
    optional: '<span class="handout__note">по показаниям</span>',
  };
  return byStatus[dose.status];
}

function doseHtml(dose: HandoutDose): string {
  const box =
    dose.status === 'done'
      ? 'handout__box handout__box--done'
      : dose.status === 'planned'
        ? 'handout__box handout__box--planned'
        : 'handout__box';
  return `<div class="handout__dose"><span class="${box}"></span><span>${escapeHtml(dose.text)}</span>${noteHtml(dose)}</div>`;
}

function whenHtml(value: string): string {
  const [from, to] = value.split(' — ');
  if (from === undefined || from === '') return '';
  return to
    ? `${escapeHtml(from)}<span class="handout__when-end">— ${escapeHtml(to)}</span>`
    : escapeHtml(from);
}

/** The whole print document of the handout. */
export function renderVaccinationHandoutHtml(handout: Handout): string {
  const { subject } = handout;
  const name = subject.name ? escapeHtml(subject.name) : '';
  const birth = subject.birthDate ? escapeHtml(displayIsoDate(subject.birthDate)) : '';
  const age = handout.ageText ? escapeHtml(handout.ageText) : '';
  const rows = handout.rows
    .map(
      (row) =>
        `<tr><td class="handout__age">${escapeHtml(row.age)}</td><td class="handout__when">${whenHtml(row.when)}</td><td class="handout__doses">${row.doses
          .map(doseHtml)
          .join('')}</td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(VACCINATION_HANDOUT_TITLE)}</title>
<style>${STYLES}</style>
</head>
<body class="handout">
<h1 class="handout__title">${escapeHtml(VACCINATION_HANDOUT_TITLE)}</h1>
<p class="handout__child"><span class="handout__label">Имя:</span><span class="handout__value">${name}</span><span class="handout__label">Родился(ась):</span><span class="handout__value handout__value--date">${birth}${age ? ` · ${age}` : ''}</span></p>
<table class="handout__table">
<thead><tr><th class="handout__head">Возраст</th><th class="handout__head">Примерная дата</th><th class="handout__head">Прививки</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p class="handout__foot">Составлено по национальному календарю профилактических прививок (приказ Минздрава № 1122н). Сроки примерные: когда делать прививку, решает врач. Распечатано ${escapeHtml(displayIsoDate(handout.printedOn))}.</p>
</body>
</html>`;
}
