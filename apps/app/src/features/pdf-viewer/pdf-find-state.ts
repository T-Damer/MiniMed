import type { DocumentFindMatch, DocumentFindUnit } from '@/features/library/document-find';
import { type PdfPageText, pdfPageHasText } from '@/features/pdf-viewer/pdf-page-text';

/** Find units of a PDF are whole pages, so a phrase can match across lines. */
const PDF_PAGE_UNIT_PREFIX = 'pdf-page-';

export function pdfPageUnitId(pageIndex: number): string {
  return `${PDF_PAGE_UNIT_PREFIX}${String(pageIndex)}`;
}

export function pdfPageIndexFromUnitId(unitId: string): number | undefined {
  if (!unitId.startsWith(PDF_PAGE_UNIT_PREFIX)) return undefined;
  const index = Number(unitId.slice(PDF_PAGE_UNIT_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

/** One unit per page that has text; pages not read yet or without a text layer are left out. */
export function pdfPageFindUnits(
  pageTexts: ReadonlyMap<number, PdfPageText>,
): readonly DocumentFindUnit[] {
  const units: DocumentFindUnit[] = [];
  for (const [pageIndex, pageText] of [...pageTexts].toSorted((a, b) => a[0] - b[0])) {
    if (pdfPageHasText(pageText)) units.push({ id: pdfPageUnitId(pageIndex), text: pageText.text });
  }
  return units;
}

export interface PdfPageFindRange {
  readonly start: number;
  readonly end: number;
  readonly active: boolean;
}

export interface PdfFindHighlights {
  /** Match ranges per 0-based page. */
  readonly byPage: ReadonlyMap<number, readonly PdfPageFindRange[]>;
  /** Page of the active match, when it is a PDF page match. */
  readonly activePage: number | undefined;
  /** Pages with at least one match. */
  readonly pageCount: number;
}

export const NO_PDF_FIND_HIGHLIGHTS: PdfFindHighlights = {
  byPage: new Map(),
  activePage: undefined,
  pageCount: 0,
};

export function pdfFindHighlights(
  matches: readonly DocumentFindMatch[],
  activeIndex: number,
): PdfFindHighlights {
  const byPage = new Map<number, PdfPageFindRange[]>();
  let activePage: number | undefined;
  matches.forEach((match, index) => {
    const pageIndex = pdfPageIndexFromUnitId(match.unitId);
    if (pageIndex === undefined) return;
    const active = index === activeIndex;
    if (active) activePage = pageIndex;
    const list = byPage.get(pageIndex) ?? [];
    list.push({ start: match.start, end: match.end, active });
    byPage.set(pageIndex, list);
  });
  return { byPage, activePage, pageCount: byPage.size };
}
