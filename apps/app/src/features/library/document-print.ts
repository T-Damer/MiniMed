import type { MedicalDocument, MedicalSection } from '@localmed/contracts';
import * as QRCode from 'qrcode';

// Official state symbol as catalogued by the Presidential Library, item 1327586.
import clinicalCoverEmblem from '@/features/library/clinical-cover-emblem.webp?inline';
import { clinicalPrintCover } from '@/features/library/clinical-print-cover';
import { documentSectionHeadingTag } from '@/features/library/document-display';
import { parseDocumentText } from '@/features/library/document-medication-links';
import {
  type DocumentRenderBlock,
  resolveDocumentChunkItems,
  visibleImageCaption,
} from '@/features/library/document-rich-block-data';
import { documentEditionValue } from '@/features/library/document-version-label';
import { PrintManager } from '@/features/printing/print-manager';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
  return `<svg class="doc-print__footer-qr" viewBox="-4 -4 ${size + 8} ${size + 8}" role="img" aria-label="QR-код страницы" shape-rendering="crispEdges"><path d="${path}" /></svg>`;
}

function renderTextBlocks(text: string): string {
  const blocks = parseDocumentText(text);
  const html: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  const closeList = (): void => {
    if (listTag) html.push(`</${listTag}>`);
    listTag = null;
  };
  for (const block of blocks) {
    if (block.kind === 'bullet') {
      if (listTag !== 'ul') {
        closeList();
        html.push('<ul class="doc-print__list">');
        listTag = 'ul';
      }
      html.push(`<li>${escapeHtml(block.text)}</li>`);
    } else if (block.kind === 'ordered') {
      if (listTag !== 'ol') {
        closeList();
        html.push('<ol class="doc-print__list">');
        listTag = 'ol';
      }
      html.push(`<li>${escapeHtml(block.text)}</li>`);
    } else if (block.kind === 'paragraph' || block.kind === 'cell') {
      closeList();
      html.push(`<p class="doc-print__paragraph">${escapeHtml(block.text)}</p>`);
    } else if (block.kind === 'table') {
      closeList();
      html.push(renderRichBlockHtml(block.table));
    }
  }
  closeList();
  return html.join('');
}

function renderRichBlockHtml(block: DocumentRenderBlock): string {
  if (block.kind === 'image') {
    const caption = visibleImageCaption(block.alt, block.title);
    return `<figure class="doc-print__figure"><img src="${escapeHtml(block.dataUrl)}" alt="${escapeHtml(caption || block.alt)}" />${
      caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
    }</figure>`;
  }
  const headerEnd = block.rows.findIndex(
    (row) => !row.cells.length || !row.cells.every((cell) => cell.header && cell.rowSpan === 1),
  );
  const renderRows = (rows: typeof block.rows): string =>
    rows
      .map((row) => {
        const cells = row.cells
          .map((cell) => {
            const tag = cell.header ? 'th' : 'td';
            const rowSpan = cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '';
            const colSpan = cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
            const alignment = cell.align ? ` style="text-align:${cell.align}"` : '';
            return `<${tag}${rowSpan}${colSpan}${alignment}>${escapeHtml(cell.text)}</${tag}>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
  const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : '';
  const head = headerEnd > 0 ? `<thead>${renderRows(block.rows.slice(0, headerEnd))}</thead>` : '';
  const rows = renderRows(block.rows.slice(Math.max(0, headerEnd)));
  return `<table class="doc-print__table">${caption}${head}<tbody>${rows}</tbody></table>`;
}

function renderSectionHtml(section: MedicalSection): string {
  const tag = documentSectionHeadingTag(section.depth);
  const body = resolveDocumentChunkItems(section.chunks)
    .map((item) =>
      item.kind === 'rich'
        ? renderRichBlockHtml(item.block)
        : renderTextBlocks(item.chunk.originalText),
    )
    .join('');
  return `<section class="doc-print__section"><${tag} class="doc-print__heading doc-print__heading--${tag}">${escapeHtml(section.title)}</${tag}>${body}</section>`;
}

function clinicalCover(document: MedicalDocument): string {
  const { codes, ages, approvalYear, developers, id } = clinicalPrintCover(document);
  const rows = [
    [
      'Кодирование по Международной статистической классификации болезней и проблем, связанных со здоровьем',
      codes.join(', '),
    ],
    ['Возрастная группа', ages.join(', ')],
    ['Год утверждения', approvalYear],
    ['ID', id],
  ];
  return `<header class="doc-print__cover">
    <img class="doc-print__cover-emblem" src="${clinicalCoverEmblem}" width="360" height="360" alt="Государственный герб Российской Федерации" />
    <p class="doc-print__cover-heading">Клинические рекомендации</p>
    <h1 class="doc-print__cover-title">${escapeHtml(document.title)}</h1>
    <dl class="doc-print__cover-facts">
      ${rows.map(([label, value]) => (value && label ? `<div class="doc-print__cover-row"><dt class="doc-print__cover-label">${escapeHtml(label)}:</dt><dd class="doc-print__cover-value">${escapeHtml(value)}</dd></div>` : '')).join('')}
    </dl>
    ${
      developers.length
        ? `<p class="doc-print__cover-developers-title">Разработчики клинических рекомендаций:</p>
      <ul class="doc-print__cover-developers">${developers.map((name) => `<li class="doc-print__cover-developer">${escapeHtml(name)}</li>`).join('')}</ul>`
        : ''
    }
  </header>`;
}

export function printableDocumentHtml(document: MedicalDocument, pageLink: string): string {
  const body = document.sections.map(renderSectionHtml).join('');
  const escapedPageLink = escapeHtml(pageLink);
  const editionValue = documentEditionValue(document.versionLabel);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.title)}</title>
  <style>
    .doc-print, .native-print-preview--document {
      --print-accent: #405b4e;
      --print-ink: #292720;
      --print-ink-muted: #585349;
      --print-rule: #cbc0a7;
      --print-title-font: Georgia, "Times New Roman", Times, serif;
      --print-body-font: system-ui, -apple-system, sans-serif;
    }
    @page { size: A4; margin: 20mm 15mm 20mm 30mm; }
    * { box-sizing: border-box; }
    .doc-print { margin: 0; padding: 0; }
    .doc-print, .native-print-preview--document .native-print-preview__content { font-family: var(--print-body-font); color: var(--print-ink); font-size: 10pt; line-height: 1.5; }
    .doc-print__title { font-family: var(--print-title-font); font-size: 20pt; line-height: 1.15; margin: 0 0 1mm; border-bottom: 1.4pt solid var(--print-accent); padding-bottom: 3mm; }
    .doc-print__meta { font-size: 8pt; color: var(--print-ink-muted); margin: 2mm 0 6mm; }
    .doc-print__section { margin-top: 5mm; }
    .doc-print__heading { break-after: avoid-page; }
    .doc-print__heading--h2 { font-family: var(--print-title-font); font-size: 13pt; color: var(--print-accent); margin: 0 0 2mm; border-top: 0.6pt solid var(--print-rule); padding-top: 3mm; }
    .doc-print__heading--h3 { font-size: 11.5pt; margin: 3mm 0 1.5mm; }
    .doc-print__heading--h4, .doc-print__heading--h5, .doc-print__heading--h6 { font-size: 10.5pt; margin: 2.5mm 0 1mm; }
    .doc-print__paragraph { margin: 0 0 2mm; line-height: 1.5; text-indent: 12.5mm; widows: 2; orphans: 2; }
    .doc-print__list { margin: 0 0 2mm; padding-left: 4.5mm; }
    .doc-print__list li { margin-bottom: 0.8mm; break-inside: avoid; }
    .doc-print__table { border-collapse: collapse; width: 100%; margin: 2mm 0 3mm; font-size: 8.5pt; table-layout: fixed; }
    .doc-print__table th, .doc-print__table td { border: 0.5pt solid var(--print-rule); padding: 1mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    .doc-print__table tr { break-inside: avoid; }
    .doc-print__table th { background: color-mix(in srgb, var(--print-accent) 12%, transparent); font-weight: 600; }
    .doc-print__table tr:nth-child(even) td { background: color-mix(in srgb, var(--print-ink) 4%, transparent); }
    .doc-print__figure { margin: 2mm 0 3mm; break-inside: avoid; }
    .doc-print__figure img { max-width: 100%; max-height: 230mm; object-fit: contain; }
    .doc-print__figure figcaption { font-size: 8pt; color: var(--print-ink-muted); margin-top: 1mm; }
    .doc-print__footer { display: flex; align-items: center; gap: 2mm; margin-top: 8mm; padding-top: 3mm; border-top: 0.6pt solid var(--print-rule); font-size: 7pt; color: var(--print-ink-muted); }
    .doc-print__footer-link { overflow-wrap: anywhere; }
    .doc-print__footer-qr { flex: 0 0 auto; width: 10mm; height: 10mm; fill: var(--print-ink); }
    .doc-print__cover { break-after: page; font-family: "Times New Roman", Times, serif; color: #111; padding-block-start: 8mm; font-size: 12pt; line-height: 1.35; }
    .doc-print__cover-emblem { display: block; width: 34mm; height: auto; margin: 0 auto 9mm; }
    .doc-print__cover-heading { margin: 0 0 1.5mm; }
    .doc-print__cover-title { margin: 0 0 11mm; font-size: 20pt; line-height: 1.2; }
    .doc-print__cover-facts { margin: 0; }
    .doc-print__cover-row { display: grid; grid-template-columns: 48% minmax(0, 1fr); gap: 4mm; align-items: start; margin-block: 5mm; }
    .doc-print__cover-label { text-align: right; }
    .doc-print__cover-value { margin: 0; overflow-wrap: anywhere; }
    .doc-print__cover-developers-title { margin: 9mm 0 2mm; }
    .doc-print__cover-developers { margin: 0; padding-inline-start: 7mm; }
    .doc-print__cover-developer { margin-block: 1mm; font-weight: 700; }
  </style>
</head>
<body class="doc-print">
  ${
    document.sourceType === 'clinical_recommendation'
      ? clinicalCover(document)
      : `<h1 class="doc-print__title">${escapeHtml(document.title)}</h1>
  ${editionValue ? `<p class="doc-print__meta">Редакция: ${escapeHtml(editionValue)}</p>` : ''}`
  }
  ${body}
  <footer class="doc-print__footer">
    <span>MiniMed</span>
    <span aria-hidden="true">⋅</span>
    <a class="doc-print__footer-link" href="${escapedPageLink}">${escapedPageLink}</a>
    <span aria-hidden="true">⋅</span>
    ${renderQrCode(pageLink)}
  </footer>
</body>
</html>`;
}

export function printDocument(document: MedicalDocument): boolean {
  const html = printableDocumentHtml(document, window.location.href);
  return PrintManager.html(html, document.title);
}

function summaryText(document: MedicalDocument): string {
  const firstSection = document.sections.find((section) => section.chunks.length > 0);
  const firstChunk = firstSection?.chunks[0];
  const firstParagraph = firstChunk
    ? parseDocumentText(firstChunk.originalText).find((block) => block.kind === 'paragraph')?.text
    : undefined;
  const lines = [document.title];
  if (firstParagraph) lines.push(firstParagraph);
  lines.push(window.location.href);
  return lines.join('\n\n');
}

/** The system share sheet where there is one, the clipboard otherwise. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied'> {
  if ('share' in navigator && typeof navigator.share === 'function') {
    await navigator.share({ title, text });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

export function shareDocument(document: MedicalDocument): Promise<'shared' | 'copied'> {
  return shareText(document.title, summaryText(document));
}
