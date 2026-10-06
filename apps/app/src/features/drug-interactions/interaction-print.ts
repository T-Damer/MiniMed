/**
 * Print and share text of an interaction check (INT1): the same quoted sentences the screen shows,
 * with their source, and the notice that this is a search over instruction texts.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export interface PrintQuote {
  readonly text: string;
  readonly section: string;
}

export interface PrintSide {
  /** «Из инструкции Варфарин (…)». */
  readonly heading: string;
  readonly source: string;
  readonly note: string | null;
  readonly quotes: readonly PrintQuote[];
}

export interface PrintPair {
  readonly title: string;
  readonly status: string;
  /** «Серьёзное по DDInter. Оценка из международной базы…», only for a pair with a label. */
  readonly severity: string | null;
  readonly sides: readonly PrintSide[];
}

export const INTERACTION_NOTICE =
  'Это поиск по текстам официальных инструкций, а не система поддержки врачебных решений. «Упоминаний не найдено» не означает, что сочетание безопасно: решение принимает врач по полной инструкции и клинической картине.';

export const INTERACTION_PRINT_TITLE = 'Взаимодействие препаратов: поиск по инструкциям';

const PRINT_STYLES = `
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .ddi-print { font-family: "Times New Roman", Times, serif; font-size: 10.5pt; line-height: 1.3; }
  .ddi-print__title { margin: 0 0 2mm; font-size: 15pt; }
  .ddi-print__notice { margin: 0 0 4mm; padding: 2mm 3mm; border: 0.3mm solid #000; font-size: 9.5pt; }
  .ddi-print__pair { margin: 0 0 5mm; break-inside: avoid-page; }
  .ddi-print__pair-title { margin: 0 0 1mm; font-size: 12pt; }
  .ddi-print__status { margin: 0 0 2mm; font-weight: bold; }
  .ddi-print__severity { margin: 0 0 2mm; font-size: 9.5pt; }
  .ddi-print__side { margin: 0 0 2.5mm; }
  .ddi-print__heading { margin: 0; font-weight: bold; }
  .ddi-print__source, .ddi-print__note { margin: 0 0 1mm; font-size: 9pt; color: #333; }
  .ddi-print__quote { margin: 0 0 1.5mm 4mm; padding-left: 2.5mm; border-left: 0.5mm solid #000; }
  .ddi-print__section { display: block; font-size: 8.5pt; color: #333; }
  .ddi-print__date { margin: 4mm 0 0; font-size: 8.5pt; color: #333; }
`;

export const SEVERITY_PRINT_SOURCE =
  'Метки степени риска: DDInter 2.0 (https://ddinter2.scbdd.com/), лицензия CC BY-NC-SA 4.0; международная база данных, не инструкции препаратов. Использование некоммерческое.';

export function renderInteractionPrintHtml(pairs: readonly PrintPair[], printedOn: string): string {
  const body = pairs
    .map(
      (pair) => `
    <section class="ddi-print__pair">
      <h2 class="ddi-print__pair-title">${escapeHtml(pair.title)}</h2>
      <p class="ddi-print__status">${escapeHtml(pair.status)}</p>
      ${pair.severity ? `<p class="ddi-print__severity">${escapeHtml(pair.severity)}</p>` : ''}
      ${pair.sides
        .map(
          (side) => `
        <div class="ddi-print__side">
          <p class="ddi-print__heading">${escapeHtml(side.heading)}</p>
          <p class="ddi-print__source">${escapeHtml(side.source)}</p>
          ${side.note ? `<p class="ddi-print__note">${escapeHtml(side.note)}</p>` : ''}
          ${side.quotes
            .map(
              (quote) =>
                `<p class="ddi-print__quote"><span class="ddi-print__section">${escapeHtml(quote.section)}</span>${escapeHtml(quote.text)}</p>`,
            )
            .join('')}
        </div>`,
        )
        .join('')}
    </section>`,
    )
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(INTERACTION_PRINT_TITLE)}</title><style>${PRINT_STYLES}</style></head><body><main class="ddi-print"><h1 class="ddi-print__title">Взаимодействие препаратов</h1><p class="ddi-print__notice">${escapeHtml(INTERACTION_NOTICE)}</p>${body}${pairs.some((pair) => pair.severity) ? `<p class="ddi-print__date">${escapeHtml(SEVERITY_PRINT_SOURCE)}</p>` : ''}<p class="ddi-print__date">Составлено ${escapeHtml(printedOn)} в приложении MiniMed по установленным текстам инструкций.</p></main></body></html>`;
}

/** The same content as plain text, for sharing or copying. */
export function interactionShareText(pairs: readonly PrintPair[]): string {
  const lines: string[] = [
    'Взаимодействие препаратов: поиск по инструкциям',
    '',
    INTERACTION_NOTICE,
    '',
  ];
  for (const pair of pairs) {
    lines.push(pair.title, pair.status);
    if (pair.severity) lines.push(pair.severity);
    for (const side of pair.sides) {
      lines.push('', side.heading, side.source);
      if (side.note) lines.push(side.note);
      for (const quote of side.quotes) lines.push(`— [${quote.section}] ${quote.text}`);
    }
    lines.push('');
  }
  if (pairs.some((pair) => pair.severity)) lines.push(SEVERITY_PRINT_SOURCE);
  return lines.join('\n').trimEnd();
}
