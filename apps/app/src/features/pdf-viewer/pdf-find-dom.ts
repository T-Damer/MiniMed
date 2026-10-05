import type { PdfPageFindRange } from '@/features/pdf-viewer/pdf-find-state';
import { type PdfPageText, pdfTextSegments } from '@/features/pdf-viewer/pdf-page-text';

/** The pieces of a rendered pdf.js text layer that find needs. */
export interface PdfTextLayerParts {
  readonly textDivs: readonly HTMLElement[];
}

interface HighlightRegistryLike {
  set(name: string, highlight: Highlight): unknown;
  delete(name: string): unknown;
}

export const PDF_FIND_HIT_HIGHLIGHT = 'pdf-find-hit';
export const PDF_FIND_ACTIVE_HIGHLIGHT = 'pdf-find-active';

export function supportsCssHighlights(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof Highlight !== 'undefined' &&
    typeof Range !== 'undefined'
  );
}

export interface PdfPageHighlight {
  readonly hit: readonly Range[];
  readonly active: readonly Range[];
  /** Text-layer spans that carry a match (fallback styling and tests). */
  readonly spans: readonly HTMLElement[];
  readonly activeSpans: readonly HTMLElement[];
}

/** DOM ranges over the text layer for the page's match ranges. */
export function buildPdfPageHighlight(
  layer: PdfTextLayerParts,
  pageText: PdfPageText,
  ranges: readonly PdfPageFindRange[],
): PdfPageHighlight {
  const hit: Range[] = [];
  const active: Range[] = [];
  const spans = new Set<HTMLElement>();
  const activeSpans = new Set<HTMLElement>();
  for (const range of ranges) {
    for (const segment of pdfTextSegments(pageText, range.start, range.end)) {
      const span = layer.textDivs[segment.itemIndex];
      const node = span?.firstChild;
      if (!span || !node || node.nodeType !== Node.TEXT_NODE) continue;
      const domRange = new Range();
      const length = node.textContent?.length ?? 0;
      domRange.setStart(node, Math.min(segment.from, length));
      domRange.setEnd(node, Math.min(segment.to, length));
      hit.push(domRange);
      spans.add(span);
      if (range.active) {
        active.push(domRange);
        activeSpans.add(span);
      }
    }
  }
  return { hit, active, spans: [...spans], activeSpans: [...activeSpans] };
}

/**
 * Highlights of every page of one viewer, published through the CSS Custom Highlight API (no DOM
 * mutation, so selection and the text layer stay intact). Engines without it get a class on the
 * spans instead.
 */
export class PdfHighlightRegistry {
  private readonly pages = new Map<number, PdfPageHighlight>();
  private readonly marked = new Map<number, readonly HTMLElement[]>();
  private readonly native = supportsCssHighlights();

  setPage(page: number, highlight: PdfPageHighlight): void {
    this.clearMarks(page);
    this.pages.set(page, highlight);
    if (!this.native) {
      for (const span of highlight.spans) span.classList.add('pdf-viewer__text-run--hit');
      for (const span of highlight.activeSpans) span.classList.add('pdf-viewer__text-run--active');
      this.marked.set(page, highlight.spans);
    }
    for (const span of highlight.spans) span.setAttribute('data-find-hit', '');
    this.publish();
  }

  clearPage(page: number): void {
    this.clearMarks(page);
    if (this.pages.delete(page)) this.publish();
  }

  clear(): void {
    for (const page of [...this.pages.keys()]) this.clearMarks(page);
    this.pages.clear();
    this.publish();
  }

  /** Total highlighted ranges, for tests and diagnostics. */
  get rangeCount(): number {
    let count = 0;
    for (const highlight of this.pages.values()) count += highlight.hit.length;
    return count;
  }

  activeRange(page: number): Range | undefined {
    return this.pages.get(page)?.active[0];
  }

  private clearMarks(page: number): void {
    const spans = this.marked.get(page) ?? [];
    for (const span of spans) {
      span.classList.remove('pdf-viewer__text-run--hit', 'pdf-viewer__text-run--active');
    }
    this.marked.delete(page);
    for (const span of this.pages.get(page)?.spans ?? []) span.removeAttribute('data-find-hit');
  }

  private publish(): void {
    if (!this.native) return;
    // TypeScript's DOM library lacks the Set-like members of the highlight objects.
    const registry = CSS.highlights as unknown as HighlightRegistryLike;
    const hitRanges: Range[] = [];
    const activeRanges: Range[] = [];
    for (const highlight of this.pages.values()) {
      hitRanges.push(...highlight.hit);
      activeRanges.push(...highlight.active);
    }
    if (hitRanges.length === 0) {
      registry.delete(PDF_FIND_HIT_HIGHLIGHT);
      registry.delete(PDF_FIND_ACTIVE_HIGHLIGHT);
      return;
    }
    // The active match must paint over the plain ones.
    const hit = new Highlight(...hitRanges);
    const active = new Highlight(...activeRanges);
    hit.priority = 0;
    active.priority = 1;
    registry.set(PDF_FIND_HIT_HIGHLIGHT, hit);
    registry.set(PDF_FIND_ACTIVE_HIGHLIGHT, active);
  }
}
