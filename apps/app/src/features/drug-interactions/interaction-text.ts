/**
 * Sentence spans of an instruction section, for the drug-interaction index (INT1).
 *
 * The instruction texts come from PDFs: every printed line is its own paragraph, a sentence is
 * wrapped over several lines, and list items often have no full stop. So a section is first turned
 * into ONE canonical string (its chunks, in order, joined by a newline) and a span is a half-open
 * `[start, end)` range of that string. The builder and the app both compute the canonical string
 * from the same chunks, so an offset written at build time points at the same characters when the
 * installed document is read. The text itself is never rewritten here; only offsets are produced.
 */

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/** The chunks of one section, in reading order, as one string, with where each chunk starts. */
export interface CanonicalSectionText {
  readonly text: string;
  /** `chunkStarts[i]` is the offset of chunk `i` in `text`. */
  readonly chunkStarts: readonly number[];
}

const CHUNK_SEPARATOR = '\n';

export function canonicalSectionText(chunkTexts: readonly string[]): CanonicalSectionText {
  const chunkStarts: number[] = [];
  let length = 0;
  for (const chunk of chunkTexts) {
    chunkStarts.push(length);
    length += chunk.length + CHUNK_SEPARATOR.length;
  }
  return { text: chunkTexts.join(CHUNK_SEPARATOR), chunkStarts };
}

/** The index of the chunk that holds `offset`. */
export function chunkIndexAt(chunkStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = chunkStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((chunkStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

/** FNV-1a (32 bit) of the canonical text as 8 hex digits: detects a changed edition, not an attacker. */
export function sectionChecksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Abbreviations after which a full stop does not end a sentence («т. е.», «напр. Ципрофлоксацин»). */
const ABBREVIATIONS = new Set([
  'т',
  'д',
  'п',
  'пр',
  'напр',
  'см',
  'рис',
  'табл',
  'ст',
  'др',
  'им',
  'гг',
  'ч',
  'мин',
  'сут',
  'мес',
  'нед',
  'табл',
  'амп',
  'мкг',
]);

const MIN_SPAN_LENGTH = 12;
/** A span longer than this is cut at line breaks: it is a list without full stops, not one sentence. */
const MAX_SPAN_LENGTH = 1_200;

function isUpperStart(character: string | undefined): boolean {
  if (character === undefined) return false;
  if (/[0-9•–—«"(-]/u.test(character)) return true;
  return character !== character.toLowerCase() && character === character.toUpperCase();
}

/** True when the full stop at `index` closes a sentence rather than an abbreviation or a number. */
function endsSentenceAt(text: string, index: number): boolean {
  let after = index + 1;
  // Closing brackets and quotes belong to the sentence that ends.
  while (after < text.length && /["»”)\]]/u.test(text.charAt(after))) after += 1;
  if (after >= text.length) return true;
  if (!/\s/u.test(text.charAt(after))) return false;
  let next = after;
  while (next < text.length && /\s/u.test(text.charAt(next))) next += 1;
  if (next >= text.length) return true;
  if (!isUpperStart(text.charAt(next))) return false;
  if (text.charAt(index) === '.') {
    const word = /([A-Za-zА-Яа-яЁё]+)$/u.exec(text.slice(Math.max(0, index - 8), index))?.[1];
    if (word && ABBREVIATIONS.has(word.toLowerCase())) return false;
  }
  return true;
}

function trimmed(text: string, start: number, end: number): TextSpan | null {
  let from = start;
  let to = end;
  while (from < to && /\s/u.test(text.charAt(from))) from += 1;
  while (to > from && /\s/u.test(text.charAt(to - 1))) to -= 1;
  return to - from >= MIN_SPAN_LENGTH ? { start: from, end: to } : null;
}

/** Cuts an over-long span at line breaks that start with a capital letter. */
function cutAtLineBreaks(text: string, span: TextSpan): readonly TextSpan[] {
  const pieces: TextSpan[] = [];
  let pieceStart = span.start;
  for (let index = span.start; index < span.end; index += 1) {
    if (text.charAt(index) !== '\n') continue;
    let next = index + 1;
    while (next < span.end && /\s/u.test(text.charAt(next))) next += 1;
    const previousLine = text.slice(pieceStart, index).trimEnd();
    if (
      next < span.end &&
      isUpperStart(text.charAt(next)) &&
      !/[,\-–:(]$/u.test(previousLine) &&
      index - pieceStart >= MIN_SPAN_LENGTH
    ) {
      const piece = trimmed(text, pieceStart, index);
      if (piece) pieces.push(piece);
      pieceStart = next;
    }
  }
  const last = trimmed(text, pieceStart, span.end);
  if (last) pieces.push(last);
  return pieces;
}

/**
 * The sentence spans of a canonical section text. A sentence ends at «.», «!» or «?» followed by a
 * space or line break and a capital letter, digit or bullet. A heading line without a full stop
 * therefore stays with the sentence that follows it («С рацекадотрилом / При одновременном
 * применении …»), which is what a reader needs: the named drug and what the text says about it.
 */
export function splitSentenceSpans(text: string): readonly TextSpan[] {
  const spans: TextSpan[] = [];
  let start = 0;
  const push = (end: number): void => {
    const span = trimmed(text, start, end);
    if (!span) return;
    if (span.end - span.start > MAX_SPAN_LENGTH) spans.push(...cutAtLineBreaks(text, span));
    else spans.push(span);
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (
      (character === '.' || character === '!' || character === '?') &&
      endsSentenceAt(text, index)
    ) {
      push(index + 1);
      start = index + 1;
    }
  }
  push(text.length);
  return spans;
}

/** The text of a span as one readable line: runs of whitespace (the PDF line breaks) become one space. */
export function spanDisplayText(text: string, span: TextSpan): string {
  return text.slice(span.start, span.end).replace(/\s+/gu, ' ').trim();
}
