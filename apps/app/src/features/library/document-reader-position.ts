/**
 * Pages of a reflowed reader.
 *
 * A reflowed document has no pages: its height changes with the text size, the window and the
 * sections that are mounted so far. A *page* is therefore a fixed amount of text — about what one
 * printed sheet holds — counted from the text the document carries, so the number of pages, the
 * page of every heading and the page a reader stands on do not depend on the layout. They are known
 * before a single section renders, and every page can be reached with the same jump the contents
 * list uses: to the section that holds the page's first character, then the fraction of that
 * section's own text it lies at.
 */

/** Characters of text on one page (a printed sheet holds 2 000–3 000). */
export const READER_PAGE_CHARS = 2400;
/** What a picture counts for, in characters of text: roughly a third of a page. */
export const READER_IMAGE_WEIGHT = 900;
/** A single page has nothing to count or jump to. */
export const MIN_READER_PAGES = 2;

export interface ReaderPageSection {
  readonly anchor: string;
  /** Size of the section's own text, in characters (`readerSectionWeight`). */
  readonly weight: number;
}

export interface ReaderPageModel {
  readonly total: number;
  readonly charsPerPage: number;
  /** The sections in reading order; `starts[i]` is where section `i` begins, in characters. */
  readonly sections: readonly ReaderPageSection[];
  readonly starts: readonly number[];
  readonly length: number;
  readonly pageByAnchor: ReadonlyMap<string, number>;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function pageOfOffset(model: Pick<ReaderPageModel, 'charsPerPage' | 'total'>, offset: number) {
  return clamp(Math.floor(offset / model.charsPerPage) + 1, 1, model.total);
}

/**
 * The page model of a document, or `null` when it fits on one page. `leading` is text that stands
 * before the first section (it moves every section down but has no section of its own).
 */
export function buildReaderPageModel(
  sections: readonly ReaderPageSection[],
  options: { readonly charsPerPage?: number; readonly leading?: number } = {},
): ReaderPageModel | null {
  const charsPerPage = options.charsPerPage ?? READER_PAGE_CHARS;
  const starts: number[] = [];
  let length = Math.max(0, options.leading ?? 0);
  for (const section of sections) {
    starts.push(length);
    length += Math.max(1, section.weight);
  }
  const total = Math.max(1, Math.ceil(length / charsPerPage));
  if (sections.length < 2 || total < MIN_READER_PAGES) return null;
  const pageByAnchor = new Map<string, number>();
  const partial = { charsPerPage, total };
  sections.forEach((section, index) => {
    if (!pageByAnchor.has(section.anchor)) {
      pageByAnchor.set(section.anchor, pageOfOffset(partial, starts[index] ?? 0));
    }
  });
  return { total, charsPerPage, sections, starts, length, pageByAnchor };
}

/** Every section counts as exactly one page: for readers that can only tell their outline entries. */
export function uniformReaderPageModel(anchors: readonly string[]): ReaderPageModel | null {
  return buildReaderPageModel(
    anchors.map((anchor) => ({ anchor, weight: READER_PAGE_CHARS })),
    { charsPerPage: READER_PAGE_CHARS },
  );
}

/** The page a section starts on (what the contents list prints next to its title). */
export function readerPageOfAnchor(model: ReaderPageModel, anchor: string): number | undefined {
  return model.pageByAnchor.get(anchor);
}

/**
 * The page the reader stands on: `fraction` (0–1) is how far through the active section's own text
 * the reading line has passed. An unknown anchor reads as the first page.
 */
export function readerPageAt(model: ReaderPageModel, anchor: string, fraction: number): number {
  const index = model.sections.findIndex((section) => section.anchor === anchor);
  if (index < 0) return 1;
  const section = model.sections[index];
  const weight = Math.max(1, section?.weight ?? 1);
  const offset = (model.starts[index] ?? 0) + clamp(fraction, 0, 1) * weight;
  return pageOfOffset(model, offset);
}

export interface ReaderPageTarget {
  readonly anchor: string;
  /** How far into the section's own text the page begins (0 = at its heading). */
  readonly fraction: number;
}

/** Where a page begins: the section holding its first character and the fraction into it. */
export function readerPageTarget(model: ReaderPageModel, page: number): ReaderPageTarget | null {
  const offset = (clamp(page, 1, model.total) - 1) * model.charsPerPage;
  let index = -1;
  for (let candidate = 0; candidate < model.sections.length; candidate += 1) {
    if ((model.starts[candidate] ?? 0) > offset) break;
    index = candidate;
  }
  const section = model.sections[Math.max(0, index)];
  if (!section) return null;
  const start = model.starts[Math.max(0, index)] ?? 0;
  const weight = Math.max(1, section.weight);
  return { anchor: section.anchor, fraction: clamp((offset - start) / weight, 0, 1) };
}

export function readerPageLabel(page: number, total: number): string {
  return `${String(page)} / ${String(total)}`;
}

export function readerPageAriaLabel(page: number, total: number): string {
  return `Страница ${String(page)} из ${String(total)}. Перейти к странице`;
}

/**
 * The number a person typed into the jump field. Digits only; a number beyond the ends is taken to
 * the nearest end rather than rejected, because «999» in a 94-page document means «the last».
 */
export function parseReaderPage(input: string, total: number): number | null {
  const text = input.trim();
  if (!/^\d{1,6}$/u.test(text) || total < 1) return null;
  return Math.min(total, Math.max(1, Number.parseInt(text, 10)));
}

/** The size of a section's own text: its heading and the chunks directly under it. */
export function readerSectionWeight(section: {
  readonly title: string;
  readonly chunks: readonly {
    readonly originalText: string;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  }[];
}): number {
  let weight = section.title.length;
  for (const chunk of section.chunks) {
    // biome-ignore lint/complexity/useLiteralKeys: chunk metadata is untyped runtime data.
    const block: unknown = chunk.metadata?.['renderBlock'];
    const isImage =
      typeof block === 'object' &&
      block !== null &&
      // biome-ignore lint/complexity/useLiteralKeys: chunk metadata is untyped runtime data.
      (block as Readonly<Record<string, unknown>>)['kind'] === 'image';
    weight += isImage
      ? Math.max(chunk.originalText.length, READER_IMAGE_WEIGHT)
      : chunk.originalText.length;
  }
  return weight;
}
