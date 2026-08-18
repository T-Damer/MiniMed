import type { MedicalDocument, MedicalSection } from '@localmed/contracts';
import * as QRCode from 'qrcode';

import { documentSectionHeadingTag } from '@/features/library/document-display';
import { parseDocumentText } from '@/features/library/document-medication-links';
import {
  type DocumentRenderBlock,
  resolveDocumentChunkItems,
  visibleImageCaption,
} from '@/features/library/document-rich-block-data';
import { printHtmlInNativeShell } from '@/features/printing/native-print';

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
    } else {
      closeList();
      html.push(`<p>${escapeHtml(block.text)}</p>`);
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
  const rows = block.rows
    .map((row) => {
      const cells = row.cells
        .map((cell) => {
          const tag = cell.header ? 'th' : 'td';
          const rowSpan = cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '';
          const colSpan = cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
          return `<${tag}${rowSpan}${colSpan}>${escapeHtml(cell.text)}</${tag}>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : '';
  return `<table class="doc-print__table">${caption}<tbody>${rows}</tbody></table>`;
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
  return `<section class="doc-print__section"><${tag}>${escapeHtml(section.title)}</${tag}>${body}</section>`;
}

function printableDocumentHtml(document: MedicalDocument, pageLink: string): string {
  const body = document.sections.map(renderSectionHtml).join('');
  const escapedPageLink = escapeHtml(pageLink);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.title)}</title>
  <style>
    :root {
      --print-page-margin: 14mm;
      --print-accent: #405b4e;
      --print-ink: #292720;
      --print-ink-muted: #585349;
      --print-rule: #cbc0a7;
      --print-title-font: Georgia, "Times New Roman", Times, serif;
      --print-body-font: system-ui, -apple-system, sans-serif;
    }
    @page { size: A4; margin: var(--print-page-margin); }
    * { box-sizing: border-box; }
    body { max-width: 190mm; margin: 0 auto; padding: 0 4mm; font-family: var(--print-body-font); color: var(--print-ink); font-size: 10pt; line-height: 1.42; }
    .doc-print__kicker { font-family: var(--print-body-font); font-size: 8pt; letter-spacing: 0.08em; text-transform: uppercase; color: var(--print-accent); margin: 0 0 2mm; }
    .doc-print__title { font-family: var(--print-title-font); font-size: 20pt; line-height: 1.15; margin: 0 0 1mm; border-bottom: 1.4pt solid var(--print-accent); padding-bottom: 3mm; }
    .doc-print__meta { font-size: 8pt; color: var(--print-ink-muted); margin: 2mm 0 6mm; }
    .doc-print__section { break-inside: avoid-page; margin-top: 5mm; }
    .doc-print__section h2 { font-family: var(--print-title-font); font-size: 13pt; color: var(--print-accent); margin: 0 0 2mm; border-top: 0.6pt solid var(--print-rule); padding-top: 3mm; }
    .doc-print__section h3 { font-size: 11.5pt; margin: 3mm 0 1.5mm; }
    .doc-print__section h4, .doc-print__section h5, .doc-print__section h6 { font-size: 10.5pt; margin: 2.5mm 0 1mm; }
    .doc-print__section p { margin: 0 0 2mm; }
    .doc-print__list { margin: 0 0 2mm; padding-left: 4.5mm; }
    .doc-print__list li { margin-bottom: 0.8mm; break-inside: avoid; }
    .doc-print__table { border-collapse: collapse; width: 100%; margin: 2mm 0 3mm; font-size: 9pt; break-inside: avoid; }
    .doc-print__table th, .doc-print__table td { border: 0.5pt solid var(--print-rule); padding: 1.2mm 2mm; text-align: left; vertical-align: top; }
    .doc-print__table th { background: color-mix(in srgb, var(--print-accent) 12%, transparent); font-weight: 600; }
    .doc-print__table tr:nth-child(even) td { background: color-mix(in srgb, var(--print-ink) 4%, transparent); }
    .doc-print__figure { margin: 2mm 0 3mm; break-inside: avoid; }
    .doc-print__figure img { max-width: 100%; }
    .doc-print__figure figcaption { font-size: 8pt; color: var(--print-ink-muted); margin-top: 1mm; }
    .doc-print__footer { display: flex; align-items: center; gap: 2mm; margin-top: 8mm; padding-top: 3mm; border-top: 0.6pt solid var(--print-rule); font-size: 7pt; color: var(--print-ink-muted); }
    .doc-print__footer-link { overflow-wrap: anywhere; }
    .doc-print__footer-qr { flex: 0 0 auto; width: 10mm; height: 10mm; fill: var(--print-ink); }
    @media print { .doc-print__section { break-inside: avoid-page; } }
  </style>
</head>
<body>
  <p class="doc-print__kicker">MiniMed — Нормы и расчёты</p>
  <h1 class="doc-print__title">${escapeHtml(document.title)}</h1>
  <p class="doc-print__meta">Редакция: ${escapeHtml(document.versionLabel)}</p>
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

export function printHtml(html: string, title: string): boolean {
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

export function printDocument(document: MedicalDocument): boolean {
  const html = printableDocumentHtml(document, window.location.href);
  return printHtml(html, document.title);
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

export async function shareDocument(document: MedicalDocument): Promise<'shared' | 'copied'> {
  const text = summaryText(document);
  if ('share' in navigator && typeof navigator.share === 'function') {
    await navigator.share({ title: document.title, text });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
