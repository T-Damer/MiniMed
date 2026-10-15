/**
 * The printed table of contents of a source document (UI-FIX1). A clinical recommendation's PDF
 * starts with its own contents: «Список сокращений ……… 4». Extracted as text it becomes the first
 * sections of the document, one «section» per contents line, and the reader opened on that debris.
 * The reader has its own outline, so these leading lines are split off and shown in one collapsed
 * block; the source text stays whole and reachable, it is only not the first thing read.
 *
 * Deterministic: a contents line is one with a run of leader dots (or dots and a page number).
 * Only the leading run of the document is split off (after a short title page, if there is one);
 * leaders anywhere else stay where they are.
 */
import type { MedicalChunk, MedicalSection } from '@localmed/contracts';

/** Five or more leader dots (or dots with spaces, or an ellipsis), or dots ending in a page number. */
const LEADER = /[….]{5,}|…{2,}|(?:\.\s){5,}|[….]{2,}\s*\d{1,4}\s*$|\s\.\s*\d{1,4}\s*$/u;
/** A section that is called the contents («Оглавление»), with or without leader dots in its lines. */
const CONTENTS_TITLE = /^(?:Оглавление|Содержание)[\s.:]*$/iu;
const CONTENTS_HEADING = /^(?:Оглавление|Содержание)(?:\s|$)/iu;
const MAX_SCANNED_SECTIONS = 120;
/** The sections and characters of a title page that may come before the contents. */
const MAX_PRELUDE_SECTIONS = 4;
const MAX_PRELUDE_CHARS = 1500;

export function isContentsLine(line: string): boolean {
  return LEADER.test(line.trim());
}

/** A third or more of the lines (an entry wraps over lines, only the last has the leader) are contents lines. */
function isContentsText(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return false;
  const leaders = lines.filter(isContentsLine).length;
  return leaders >= 1 && leaders / lines.length >= 1 / 3;
}

function isContentsChunk(chunk: MedicalChunk): boolean {
  return isContentsText(chunk.originalText);
}

/** Nothing but contents lines: a title that is one with no text of its own, or text of contents lines. */
function isContentsSection(section: MedicalSection): boolean {
  if (CONTENTS_TITLE.test(section.title.trim())) return true;
  if (!section.chunks.every(isContentsChunk)) return false;
  return section.chunks.length > 0 || isContentsLine(section.title);
}

/**
 * Where the contents begin inside a chunk that starts with a title page: the offset of the first
 * line that is a «Оглавление» heading when contents lines follow it.
 */
function headingOffset(text: string): number | null {
  let offset = 0;
  for (const line of text.split('\n')) {
    if (CONTENTS_HEADING.test(line.trim())) {
      return text.slice(offset).split('\n').some(isContentsLine) ? offset : null;
    }
    offset += line.length + 1;
  }
  return null;
}

interface Start {
  /** Index of the section the contents begin in. */
  readonly section: number;
  /** Chunk of that section, and the offset in its text, where they begin. */
  readonly chunk: number;
  readonly offset: number;
}

function findStart(sections: readonly MedicalSection[]): Start | null {
  let prelude = 0;
  for (let index = 0; index < Math.min(sections.length, MAX_PRELUDE_SECTIONS); index += 1) {
    const section = sections[index] as MedicalSection;
    // A «Оглавление» heading with contents lines after it, in a chunk that no contents chunk
    // precedes: what comes before the heading is the title page.
    const headed = section.chunks.findIndex((chunk) => headingOffset(chunk.originalText) !== null);
    if (headed >= 0 && section.chunks.slice(0, headed).every((chunk) => !isContentsChunk(chunk))) {
      const offset = headingOffset((section.chunks[headed] as MedicalChunk).originalText);
      if (offset !== null) return { section: index, chunk: headed, offset };
    }
    if (isContentsSection(section)) return { section: index, chunk: 0, offset: 0 };
    prelude += section.title.length;
    for (const chunk of section.chunks) prelude += chunk.originalText.length;
    if (prelude > MAX_PRELUDE_CHARS) return null;
  }
  return null;
}

export interface PrintedContents {
  /** The printed contents: whole sections, and the contents part of the sections they run into. */
  readonly sections: readonly MedicalSection[];
  /** The document without them. */
  readonly body: readonly MedicalSection[];
}

const NONE = (sections: readonly MedicalSection[]): PrintedContents => ({
  sections: [],
  body: sections,
});

export function splitPrintedContents(sections: readonly MedicalSection[]): PrintedContents {
  const start = findStart(sections);
  if (!start) return NONE(sections);

  // The first contents section: a title page may come before the contents in it, and text of the
  // document itself after them (the PDF's contents and its abbreviations as one «section»).
  const first = sections[start.section] as MedicalSection;
  const startChunk = first.chunks[start.chunk];
  const startText = startChunk?.originalText ?? '';
  const prelude = startChunk ? startText.slice(0, start.offset).trimEnd() : '';
  const before: MedicalChunk[] = first.chunks.slice(0, start.chunk);
  if (startChunk && prelude !== '') before.push({ ...startChunk, originalText: prelude });
  let last = start.chunk;
  while (
    last + 1 < first.chunks.length &&
    isContentsChunk(first.chunks[last + 1] as MedicalChunk)
  ) {
    last += 1;
  }
  const inContents: MedicalChunk[] = startChunk
    ? [
        prelude === ''
          ? startChunk
          : { ...startChunk, originalText: startText.slice(start.offset) },
        ...first.chunks.slice(start.chunk + 1, last + 1),
      ]
    : [];
  const after = first.chunks.slice(last + 1);

  const body: MedicalSection[] = sections.slice(0, start.section);
  const contents: MedicalSection[] = [];
  const keeps = before.length > 0 || after.length > 0;
  if (keeps) body.push({ ...first, chunks: [...before, ...after] });
  contents.push({ ...first, ...(keeps ? { title: '' } : {}), chunks: inContents });

  let end = start.section + 1;
  if (after.length === 0) {
    const scanned = sections.slice(0, MAX_SCANNED_SECTIONS);
    const flags = scanned.map(isContentsSection);
    // The first line of a wrapped contents entry is a title with no leader and no text of its own
    // («1. Краткая информация по заболеванию или состоянию (группе заболеваний или»): it belongs to
    // the contents when the line after it does.
    for (let index = flags.length - 2; index > start.section; index -= 1) {
      const section = scanned[index] as MedicalSection;
      if (!flags[index] && section.chunks.length === 0 && flags[index + 1]) flags[index] = true;
    }
    while (end < flags.length && flags[end]) end += 1;
    contents.push(...sections.slice(start.section + 1, end));
  }

  // The contents may spill into the section that follows: its first chunks are contents lines.
  const boundary = sections[end];
  let spill = 0;
  if (boundary && after.length === 0) {
    while (
      spill < boundary.chunks.length &&
      isContentsChunk(boundary.chunks[spill] as MedicalChunk)
    ) {
      spill += 1;
    }
  }
  let rest = sections.slice(end);
  if (boundary && spill > 0) {
    const remaining = boundary.chunks.slice(spill);
    const moved = { ...boundary, chunks: boundary.chunks.slice(0, spill) };
    // The boundary section keeps its title above the text that is really its own.
    contents.push(remaining.length > 0 ? { ...moved, title: '' } : moved);
    rest =
      remaining.length > 0
        ? [{ ...boundary, chunks: remaining }, ...sections.slice(end + 1)]
        : sections.slice(end + 1);
  }

  // A lone leader line or two is a stray line of a table, not the contents of the document.
  const named = CONTENTS_TITLE.test(first.title.trim());
  if (
    contents.length < 2 &&
    !named &&
    !CONTENTS_HEADING.test(contents[0]?.chunks[0]?.originalText ?? '')
  ) {
    const lines = contents.reduce((sum, section) => sum + section.chunks.length, 0);
    if (lines < 3) return NONE(sections);
  }
  return { sections: contents, body: [...body, ...rest] };
}

/** One contents line for the screen: the leader dots become one ellipsis, the text is kept. */
export function presentContentsLine(line: string): string {
  return line.replace(/\s*(?:\.{3,}|…+|(?:\.\s){3,})\s*/gu, ' … ').trim();
}
