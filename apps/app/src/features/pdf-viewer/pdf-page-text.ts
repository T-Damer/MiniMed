/**
 * Searchable text of one PDF page, built from the same pdf.js text items that the text layer turns
 * into spans. Item `i` here is `textDivs[i]` of the rendered layer, so a match range can be mapped
 * back to the DOM without a second source of truth.
 */

export interface PdfTextItemLike {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

export interface PdfPageText {
  readonly text: string;
  /** Start of each text item inside `text`. */
  readonly itemStarts: readonly number[];
  /** Length of each text item's own string (the line separator is not part of it). */
  readonly itemLengths: readonly number[];
}

export interface PdfTextSegment {
  readonly itemIndex: number;
  /** Offsets inside the item's own string. */
  readonly from: number;
  readonly to: number;
}

export const EMPTY_PDF_PAGE_TEXT: PdfPageText = { text: '', itemStarts: [], itemLengths: [] };

/**
 * Items without `str` are marked-content markers and are skipped, exactly as the pdf.js text layer
 * skips them. A line end becomes one space, so a phrase can match across lines and offsets stay
 * aligned with the items.
 */
export function buildPdfPageText(items: readonly PdfTextItemLike[]): PdfPageText {
  const itemStarts: number[] = [];
  const itemLengths: number[] = [];
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    itemStarts.push(text.length);
    itemLengths.push(item.str.length);
    text += item.str;
    if (item.hasEOL === true) text += ' ';
  }
  return { text, itemStarts, itemLengths };
}

export function pdfPageHasText(pageText: PdfPageText): boolean {
  return pageText.text.trim().length > 0;
}

/** Index of the last item that starts at or before `offset`, or -1. */
function itemAtOrBefore(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] ?? 0) <= offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** The pieces of items covered by `[start, end)` of the page text. */
export function pdfTextSegments(
  pageText: PdfPageText,
  start: number,
  end: number,
): readonly PdfTextSegment[] {
  if (end <= start) return [];
  const segments: PdfTextSegment[] = [];
  let index = Math.max(0, itemAtOrBefore(pageText.itemStarts, start));
  for (; index < pageText.itemStarts.length; index += 1) {
    const itemStart = pageText.itemStarts[index] ?? 0;
    const itemEnd = itemStart + (pageText.itemLengths[index] ?? 0);
    if (itemStart >= end) break;
    const from = Math.max(start, itemStart) - itemStart;
    const to = Math.min(end, itemEnd) - itemStart;
    if (to > from) segments.push({ itemIndex: index, from, to });
  }
  return segments;
}
