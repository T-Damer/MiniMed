/**
 * The line below which a section does not count as read yet. `minimumOffset` keeps it under the
 * sticky headings: a section that a jump has just aligned to `scroll-margin-top` must be the active
 * one, even when that margin is deeper than 120px.
 */
export function computeReadingLine(scrollerRect: DOMRect, minimumOffset = 0): number {
  return scrollerRect.top + Math.max(minimumOffset, Math.min(120, scrollerRect.height * 0.2));
}

/**
 * True while the browser skips rendering the section (`content-visibility: auto` far off screen).
 * Such a section's box can be stale — a nested one may still report where it sat before the page
 * scrolled — so it is no evidence of where the reader is. The section being read is always rendered.
 */
export function skippedByContentVisibility(section: HTMLElement): boolean {
  return section.checkVisibility?.({ contentVisibilityAuto: true }) === false;
}

/**
 * The last item whose top is above the reading line (at it too unless `strict`), among items the
 * browser lays out. Tops grow in document order, so the search starts from the previous answer
 * (`hint`) and walks only as far as the reader scrolled: a long document no longer measures every
 * section above the line on every frame (owner 2026-11-06, the reader lagged).
 */
export function lastItemAboveLine(
  items: readonly HTMLElement[],
  line: number,
  hint = -1,
  strict = false,
): number {
  const above = (index: number): boolean => {
    const top = items[index]?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
    return strict ? top < line : top <= line;
  };
  const usable = (index: number): boolean => {
    const item = items[index];
    return item !== undefined && !skippedByContentVisibility(item);
  };
  let index = Math.min(hint, items.length - 1);
  while (index >= 0 && !usable(index)) index -= 1;
  if (index >= 0 && !above(index)) {
    while (index >= 0 && (!usable(index) || !above(index))) index -= 1;
    return index;
  }
  for (let next = index + 1; next < items.length; next += 1) {
    if (!usable(next)) continue;
    if (!above(next)) break;
    index = next;
  }
  return index;
}

export function pickActiveSectionAnchor(
  sections: readonly HTMLElement[],
  readingLine: number,
  hint = -1,
): string {
  if (sections.length === 0) return '';
  const index = lastItemAboveLine(sections, readingLine, hint);
  return sections[Math.max(index, 0)]?.id ?? '';
}

/**
 * How the contents list moves to keep the active entry in its middle. Following the reader one entry
 * at a time glides; a far jump (a heading or a page number picked from a distance) lands at once
 * rather than sweeping the whole list past.
 */
export function outlineCenterScroll(delta: number, viewportHeight: number): ScrollToOptions | null {
  if (Math.abs(delta) < 1) return null;
  return { top: delta, behavior: Math.abs(delta) <= viewportHeight ? 'smooth' : 'instant' };
}

export function centerOutlineItem(viewport: HTMLElement, item: HTMLElement): void {
  const viewportRect = viewport.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const scroll = outlineCenterScroll(
    itemRect.top - viewportRect.top - (viewport.clientHeight - item.clientHeight) / 2,
    viewport.clientHeight,
  );
  if (scroll) viewport.scrollBy(scroll);
}

export const DESKTOP_READER_LAYOUT_QUERY = '(min-width: 761px)';

export function isDesktopReaderLayout(): boolean {
  return window.matchMedia(DESKTOP_READER_LAYOUT_QUERY).matches;
}

export function readerScrollBehavior(): ScrollBehavior {
  return isDesktopReaderLayout() ? 'smooth' : 'instant';
}

export function outlineItemSelector(attrName: string, anchor: string): string {
  return `[${attrName}="${anchor}"]`;
}
