/**
 * Splits the text of one instruction section into the units that «Сравнение препаратов» compares
 * (CMP1): sentences and list items. A unit is a half-open `[start, end)` span of the section's
 * canonical text (see `drug-interactions/interaction-text.ts`), so what is shown is always a plain
 * substring of the instruction, never a rewritten text.
 *
 * The instruction texts come from PDFs: every printed line is its own paragraph, a sentence or a
 * list item is wrapped over several lines, bullets are private-use glyphs. The rules, in order:
 *
 * 1. A new unit starts at a bullet («•», the private-use bullet of Word PDFs, a dash followed by
 *    a space, «1.» / «2)»).
 * 2. Otherwise a printed line continues the unit before it, unless that unit already ended with
 *    «.», «!», «?» or «;» and the line starts with a capital letter, a digit or a quote.
 * 3. Inside one unit a sentence ends at «.», «!» or «?» followed by a capital letter (abbreviations
 *    such as «т. е.» do not end it), and a list item ends at «;» outside brackets.
 * 4. A short heading («Симптомы:», «Лечение.») stays with the unit that follows it.
 * 5. The section's own title, repeated at the start of its text, is not a unit.
 */
import {
  endsSentenceAt,
  isUpperStart,
  type TextSpan,
} from '@/features/drug-interactions/interaction-text';
import { titlePrefixLength } from '@/features/medication-safety/safety-extract';

/** Private-use bullet of Word → PDF text, round and square bullets, a middle dot. */
const BULLET_GLYPHS = '•●▪■·‣⁃';
const BULLET_START = new RegExp(`^(?:[${BULLET_GLYPHS}]|[–—−-](?=\\s))\\s*`, 'u');
const NUMBERED_START = /^\d{1,2}[.)]\s+(?=[A-ZА-ЯЁ«"(])/u;
const INLINE_BULLET = new RegExp(`(?<=\\s)[${BULLET_GLYPHS}](?=\\s)`, 'gu');

/** A unit shorter than this (letters only) is dropped: a stray number or a page mark. */
const MIN_LETTERS = 3;
const MAX_HEADING_WORDS = 2;
const MIN_WORDS_AFTER_HEADING = 4;

interface Line {
  readonly start: number;
  readonly end: number;
  /** Offset where the text starts, after a bullet marker. */
  readonly textStart: number;
  readonly bullet: boolean;
}

function lineBreaks(text: string, from: number): readonly Line[] {
  const lines: Line[] = [];
  let cursor = from;
  while (cursor <= text.length) {
    let end = text.indexOf('\n', cursor);
    if (end < 0) end = text.length;
    let start = cursor;
    let stop = end;
    while (start < stop && /\s/u.test(text.charAt(start))) start += 1;
    while (stop > start && /\s/u.test(text.charAt(stop - 1))) stop -= 1;
    if (stop > start) {
      const head = text.slice(start, Math.min(stop, start + 8));
      const marker = BULLET_START.exec(head) ?? NUMBERED_START.exec(head);
      lines.push({
        start,
        end: stop,
        textStart: marker ? start + marker[0].length : start,
        bullet: marker !== null,
      });
    }
    cursor = end + 1;
  }
  return lines;
}

function endsWithTerminal(text: string, start: number, end: number): boolean {
  for (let at = end - 1; at >= start; at -= 1) {
    const character = text.charAt(at);
    if (/[\s"»”)\]]/u.test(character)) continue;
    return character === '.' || character === '!' || character === '?' || character === ';';
  }
  return false;
}

/** Lines that belong together: one logical paragraph per bullet or finished sentence. */
function paragraphsOf(text: string, lines: readonly Line[]): readonly TextSpan[] {
  const paragraphs: TextSpan[] = [];
  let current: { start: number; end: number } | null = null;
  for (const line of lines) {
    if (current === null) {
      current = { start: line.textStart, end: line.end };
      continue;
    }
    const first = text.charAt(line.start);
    const continues =
      !line.bullet && !(endsWithTerminal(text, current.start, current.end) && isUpperStart(first));
    if (continues) {
      current.end = line.end;
    } else {
      paragraphs.push(current);
      current = { start: line.textStart, end: line.end };
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

function trimmed(text: string, start: number, end: number): TextSpan | null {
  let from = start;
  let to = end;
  while (from < to && /\s/u.test(text.charAt(from))) from += 1;
  while (to > from && /\s/u.test(text.charAt(to - 1))) to -= 1;
  return to > from ? { start: from, end: to } : null;
}

/** Cuts a paragraph into sentences and «;» items. */
function cutParagraph(text: string, paragraph: TextSpan): readonly TextSpan[] {
  const pieces: TextSpan[] = [];
  const bulletCuts = new Set<number>();
  for (const match of text.slice(paragraph.start, paragraph.end).matchAll(INLINE_BULLET)) {
    bulletCuts.add(paragraph.start + (match.index ?? 0));
  }
  let from = paragraph.start;
  let depth = 0;
  const cutAt = (end: number, next: number): void => {
    const piece = trimmed(text, from, end);
    if (piece) pieces.push(piece);
    from = next;
  };
  for (let at = paragraph.start; at < paragraph.end; at += 1) {
    const character = text.charAt(at);
    if (bulletCuts.has(at)) {
      cutAt(at, at + 1);
      continue;
    }
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (
      (character === '.' || character === '!' || character === '?') &&
      depth === 0 &&
      at + 1 < paragraph.end &&
      endsSentenceAt(text, at)
    ) {
      let end = at + 1;
      while (end < paragraph.end && /["»”)\]]/u.test(text.charAt(end))) end += 1;
      cutAt(end, end);
    } else if (character === ';' && depth === 0 && at + 1 < paragraph.end) {
      cutAt(at + 1, at + 1);
    }
  }
  cutAt(paragraph.end, paragraph.end);
  return pieces;
}

function wordCount(text: string, span: TextSpan): number {
  return (text.slice(span.start, span.end).match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

function isHeadingLike(text: string, span: TextSpan): boolean {
  const piece = text.slice(span.start, span.end);
  return wordCount(text, span) <= MAX_HEADING_WORDS && /[.:]$/u.test(piece) && !/\d/u.test(piece);
}

/** The spans of the units of a section text. `title` is the section's own title, when known. */
export function splitComparisonItems(text: string, title = ''): readonly TextSpan[] {
  const skip = title ? titlePrefixLength(text, title) : 0;
  const paragraphs = paragraphsOf(text, lineBreaks(text, skip));
  const pieces: TextSpan[] = [];
  for (const paragraph of paragraphs) pieces.push(...cutParagraph(text, paragraph));
  // A short heading stays with the unit after it.
  const merged: TextSpan[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    if (!piece) continue;
    const next = pieces[index + 1];
    if (next && isHeadingLike(text, piece) && wordCount(text, next) >= MIN_WORDS_AFTER_HEADING) {
      pieces[index + 1] = { start: piece.start, end: next.end };
      continue;
    }
    merged.push(piece);
  }
  return merged.filter(
    (span) => (text.slice(span.start, span.end).match(/\p{L}/gu) ?? []).length >= MIN_LETTERS,
  );
}
