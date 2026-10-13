import { escapeHtml } from '@/features/forms/form-print';

export const RECIPE_PRINT_TITLE = 'Рецепт';

/** The recipe text as a page that prints on A4: monospace-free, one block per line. */
export function renderRecipePrintHtml(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => (line.trim() === '' ? '<p>&nbsp;</p>' : `<p>${escapeHtml(line)}</p>`))
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${RECIPE_PRINT_TITLE}</title><style>
  @page { size: A4; margin: 20mm 15mm 20mm 25mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111; font: 13pt/1.45 "Times New Roman", serif; }
  p { margin: 0; white-space: pre-wrap; }
</style></head><body>${lines}</body></html>`;
}
