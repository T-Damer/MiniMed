import { pdfPageUnitId } from '@/features/pdf-viewer/pdf-find-state';
import type { PdfViewerModel } from '@/features/pdf-viewer/pdf-viewer-model';

/** A selection on one page, as offsets into that page's pdf.js text. */
export interface PdfSelectionTarget {
  /** `pdf-page-<index>`: the unit id find and highlights share. */
  readonly pageAnchor: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

/** The character offset where `range` starts inside a text-layer span of `length` characters. */
function startInSpan(range: Range, span: HTMLElement, length: number): number {
  if (!span.contains(range.startContainer)) return 0;
  // A boundary on the span itself counts children: 0 is before its text, anything else after it.
  if (range.startContainer === span) return range.startOffset > 0 ? length : 0;
  return Math.min(range.startOffset, length);
}

function endInSpan(range: Range, span: HTMLElement, length: number): number {
  if (!span.contains(range.endContainer)) return length;
  if (range.endContainer === span) return range.endOffset > 0 ? length : 0;
  return Math.min(range.endOffset, length);
}

/**
 * The part of a selection on each PDF page that has a text layer. Item `i` of a page's text is the
 * span `textDivs[i]`, so the offsets come straight from the spans the selection touches.
 */
export function pdfSelectionTargets(
  range: Range,
  pagesRoot: HTMLElement,
  model: Pick<PdfViewerModel, 'textLayerParts' | 'pageText'>,
): readonly PdfSelectionTarget[] {
  const targets: PdfSelectionTarget[] = [];
  for (const page of Array.from(pagesRoot.querySelectorAll<HTMLElement>('[data-pdf-page]'))) {
    if (!range.intersectsNode(page)) continue;
    const pageIndex = Number(page.dataset['pdfPage']);
    const layer = model.textLayerParts(pageIndex);
    const text = model.pageText(pageIndex);
    if (!Number.isInteger(pageIndex) || !layer || !text) continue;
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    layer.textDivs.forEach((span, itemIndex) => {
      if (!range.intersectsNode(span)) return;
      const length = text.itemLengths[itemIndex] ?? 0;
      const base = text.itemStarts[itemIndex] ?? 0;
      const from = startInSpan(range, span, length);
      const to = endInSpan(range, span, length);
      if (to <= from) return;
      start = Math.min(start, base + from);
      end = Math.max(end, base + to);
    });
    if (!Number.isFinite(start) || end <= start) continue;
    const quote = text.text.slice(start, end);
    if (quote.trim().length === 0) continue;
    targets.push({ pageAnchor: pdfPageUnitId(pageIndex), start, end, quote });
  }
  return targets;
}
