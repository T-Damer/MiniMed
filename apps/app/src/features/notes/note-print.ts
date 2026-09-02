import katexCss from 'katex/dist/katex.css?inline';

import { escapePrintHtml } from '@/features/library/user-document-reader-helpers';

export function buildNotePrintHtml(
  title: string,
  date: string | undefined,
  contentHtml: string,
  templatePrint = false,
): string {
  const normalizedTitle = title.trim();
  const normalizedDate = date?.trim() ?? '';
  const heading = normalizedTitle
    ? `<h1 class="note-print__title">${escapePrintHtml(normalizedTitle)}</h1>`
    : '';
  const dateMarkup = normalizedDate
    ? `<p class="note-print__date">${escapePrintHtml(normalizedDate)}</p>`
    : '';

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapePrintHtml(normalizedTitle || 'Заметка')}</title>
  <style>
    :root {
      --note-print-title-font: Georgia, "Times New Roman", Times, serif;
      --note-print-body-font: Arial, Helvetica, sans-serif;
    }
    @page { size: A4; margin: ${templatePrint ? '10mm' : '18mm'}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1f2422;
      background: #fff;
      font-family: var(--note-print-body-font);
      font-size: 14px;
      line-height: 1.55;
    }
    .note-print__article { max-width: 65ch; margin: 0 auto; }
    .note-print__header { margin: 0 0 1.75rem; }
    .note-print__title {
      margin: 0 0 0.25rem;
      font-family: var(--note-print-title-font);
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
    }
    .note-print__date { margin: 0; color: #666; font-size: 12px; }
    .note-print__heading {
      margin: 1.2em 0 0.4em;
      font-family: var(--note-print-title-font);
      line-height: 1.2;
      break-after: avoid;
    }
    .note-print__blockquote {
      margin: 0.7em 0;
      padding: 0.3em 0.9em;
      border-left: 3px solid #999;
      color: #444;
    }
    .note-print__pre {
      padding: 0.6em 0.8em;
      border: 1px solid #ddd;
      background: #f6f6f2;
      white-space: pre-wrap;
    }
    .note-print__code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.88em; }
    .note-print__table { width: 100%; border-collapse: collapse; }
    .note-print__table-cell {
      padding: 0.35em 0.5em;
      border: 1px solid #bbb;
      text-align: left;
      vertical-align: top;
    }
    .note-print__image { max-width: 100%; }
    .note-print__rule { border: 0; border-top: 1px solid #bbb; }
    .katex { font-size: 1em; }
    .katex-display { margin: 0.8em 0; overflow-x: auto; }
    ${katexCss}
  </style>
</head>
<body>
  <article class="note-print__article">
    <header class="note-print__header">${heading}${dateMarkup}</header>
    <div class="note-print__content">${contentHtml}</div>
  </article>
</body>
</html>`;
}
