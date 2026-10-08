import { skippedByContentVisibility } from '@/features/library/document-reader-outline';

const SECTION_SELECTOR = '.document-overlay-section';
const TITLE_SELECTOR = '.document-overlay-section__title';

/**
 * Index of the deepest heading that has scrolled under the line (the bottom of the sticky path
 * line), or -1 while none has. Headings are in document order, so a parent comes before its
 * children; one the browser skips (`content-visibility`) reports a stale box and is ignored.
 */
export function pickStuckHeadingIndex(headings: readonly HTMLElement[], line: number): number {
  let index = -1;
  for (const [position, heading] of headings.entries()) {
    if (skippedByContentVisibility(heading)) continue;
    if (heading.getBoundingClientRect().top >= line) break;
    index = position;
  }
  return index;
}

function titleText(heading: Element | null): string {
  return (heading?.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

/** The titles of a heading's section and of the sections that contain it, outermost first. */
export function sectionTitlePath(heading: HTMLElement): readonly string[] {
  const titles: string[] = [];
  let section = heading.closest<HTMLElement>(SECTION_SELECTOR);
  while (section) {
    const text = titleText(section.querySelector(`:scope > ${TITLE_SELECTOR}`));
    if (text) titles.unshift(text);
    section = section.parentElement?.closest<HTMLElement>(SECTION_SELECTOR) ?? null;
  }
  return titles;
}

export function sameTitlePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((title, index) => title === right[index]);
}

const NUMBER_LABEL = /^(?:\d+(?:\.\d+)*\.?|Приложение\s+[A-ZА-ЯЁ0-9]+\.?)(?=\s|$)/u;

/**
 * An outer section in the path line: the number or appendix letter of a numbered title («3.1»,
 * «Приложение Г1»), which says where it sits; any other title stays whole.
 */
export function sectionPathLabel(title: string): string {
  return title.match(NUMBER_LABEL)?.[0] ?? title;
}
