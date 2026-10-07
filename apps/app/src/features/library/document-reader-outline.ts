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
function skippedByContentVisibility(section: HTMLElement): boolean {
  return section.checkVisibility?.({ contentVisibilityAuto: true }) === false;
}

export function pickActiveSectionAnchor(
  sections: readonly HTMLElement[],
  readingLine: number,
): string {
  if (sections.length === 0) return '';
  let nextAnchor = sections[0]?.id ?? '';
  for (const section of sections) {
    if (skippedByContentVisibility(section)) continue;
    if (section.getBoundingClientRect().top > readingLine) break;
    nextAnchor = section.id;
  }
  return nextAnchor;
}

export function centerOutlineItem(viewport: HTMLElement, item: HTMLElement): void {
  const viewportRect = viewport.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  viewport.scrollTop +=
    itemRect.top - viewportRect.top - (viewport.clientHeight - item.clientHeight) / 2;
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
