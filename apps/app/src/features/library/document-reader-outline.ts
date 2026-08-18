export function computeReadingLine(scrollerRect: DOMRect): number {
  return scrollerRect.top + Math.min(120, scrollerRect.height * 0.2);
}

export function pickActiveSectionAnchor(
  sections: readonly HTMLElement[],
  readingLine: number,
): string {
  if (sections.length === 0) return '';
  let nextAnchor = sections[0]?.id ?? '';
  for (const section of sections) {
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

export function isDesktopReaderLayout(): boolean {
  return window.matchMedia('(min-width: 761px)').matches;
}

export function readerScrollBehavior(): ScrollBehavior {
  return isDesktopReaderLayout() ? 'smooth' : 'instant';
}

export function outlineItemSelector(attrName: string, anchor: string): string {
  return `[${attrName}="${anchor}"]`;
}
