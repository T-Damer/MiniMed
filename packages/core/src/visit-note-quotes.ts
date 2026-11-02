import type { VisitNoteQuote, VisitNoteQuoteSource } from '@localmed/contracts';
import { normalizeSurfaceTextWithOffsets } from '@localmed/search-lexical';

/**
 * Quote location for the visit-note draft (SCRIBE1). A quote counts when its words appear in the
 * source in the same order, whole words only; case, «ё», punctuation and line breaks do not matter.
 * An occurrence directly behind a negation («не», «нет», «без», «отрицает») is not the same claim:
 * «болит голова» is not supported by «не болит голова». Positions always point back into the source
 * lines as given, so a draft can open the transcript at the quoted words.
 */

/** Shorter quotes (in normalized characters) match too many places to support anything. */
export const QUOTE_MIN_CHARS = 8;

const NEGATIONS = new Set([
  'не',
  'нет',
  'ни',
  'без',
  'отрицает',
  'отрицал',
  'отрицала',
  'отрицают',
]);

interface SourceOffset {
  readonly start: number;
  readonly end: number;
}

export interface QuoteWords {
  /** Lower-case words of letters and digits, separated by single spaces. */
  readonly text: string;
  /** Source span of every character of `text`. */
  readonly offsets: readonly SourceOffset[];
}

/** The words of `value` as quote matching sees them, with source offsets per character. */
export function quoteWords(value: string): QuoteWords {
  const surface = normalizeSurfaceTextWithOffsets(value);
  const chars: string[] = [];
  const offsets: SourceOffset[] = [];
  let index = 0;
  for (const character of surface.text) {
    const offset = surface.offsets[index] as SourceOffset;
    index += character.length;
    if (/[0-9a-zа-я]/u.test(character)) {
      chars.push(character);
      offsets.push(offset);
    } else if (chars.length > 0 && chars.at(-1) !== ' ') {
      chars.push(' ');
      offsets.push(offset);
    }
  }
  if (chars.at(-1) === ' ') {
    chars.pop();
    offsets.pop();
  }
  return { text: chars.join(''), offsets };
}

interface IndexedPosition {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

export interface QuoteSourceIndex {
  readonly source: VisitNoteQuoteSource;
  readonly lines: readonly string[];
  readonly text: string;
  readonly positions: readonly IndexedPosition[];
}

/** Indexes source lines once; every quote of a draft is then located against the same index. */
export function indexQuoteSource(
  source: VisitNoteQuoteSource,
  lines: readonly string[],
): QuoteSourceIndex {
  let text = '';
  const positions: IndexedPosition[] = [];
  lines.forEach((line, lineIndex) => {
    const words = quoteWords(line);
    if (!words.text) return;
    if (text) {
      text += ' ';
      positions.push(positions.at(-1) as IndexedPosition);
    }
    text += words.text;
    for (const offset of words.offsets) positions.push({ line: lineIndex, ...offset });
  });
  return { source, lines, text, positions };
}

export type QuoteLocation =
  | { readonly ok: true; readonly quote: VisitNoteQuote }
  | { readonly ok: false; readonly code: 'quote-too-short' | 'quote-not-found' | 'quote-negated' };

/** Finds `quote` in the source; the first occurrence that is not negated wins. */
export function locateQuote(index: QuoteSourceIndex, quote: string): QuoteLocation {
  const needle = quoteWords(quote.normalize('NFC')).text;
  if (needle.length < QUOTE_MIN_CHARS) return { ok: false, code: 'quote-too-short' };
  const quoteIsNegation = NEGATIONS.has(needle.split(' ', 1)[0] as string);
  let negated = false;
  for (let at = index.text.indexOf(needle); at >= 0; at = index.text.indexOf(needle, at + 1)) {
    const after = at + needle.length;
    if (at > 0 && index.text[at - 1] !== ' ') continue;
    if (after < index.text.length && index.text[after] !== ' ') continue;
    if (!quoteIsNegation && negatedAt(index, at)) {
      negated = true;
      continue;
    }
    return { ok: true, quote: quoteAt(index, at, after - 1) };
  }
  return { ok: false, code: negated ? 'quote-negated' : 'quote-not-found' };
}

/** The word before `at` is a negation written right next to it, with no punctuation between. */
function negatedAt(index: QuoteSourceIndex, at: number): boolean {
  if (at < 2) return false;
  const wordEnd = at - 1;
  const wordStart = index.text.lastIndexOf(' ', wordEnd - 1) + 1;
  if (!NEGATIONS.has(index.text.slice(wordStart, wordEnd))) return false;
  const negation = index.positions[wordEnd - 1] as IndexedPosition;
  const quoted = index.positions[at] as IndexedPosition;
  const gap =
    negation.line === quoted.line
      ? (index.lines[quoted.line] as string).slice(negation.end, quoted.start)
      : `${(index.lines[negation.line] as string).slice(negation.end)}\n${(index.lines[quoted.line] as string).slice(0, quoted.start)}`;
  return /^\s+$/u.test(gap);
}

function quoteAt(index: QuoteSourceIndex, first: number, last: number): VisitNoteQuote {
  const start = index.positions[first] as IndexedPosition;
  const end = index.positions[last] as IndexedPosition;
  const pieces: string[] = [];
  for (let line = start.line; line <= end.line; line += 1) {
    const value = index.lines[line] as string;
    const from = line === start.line ? start.start : 0;
    const to = line === end.line ? end.end : value.length;
    const piece = value.slice(from, to).trim();
    if (piece) pieces.push(piece);
  }
  return {
    source: index.source,
    startLine: start.line,
    start: start.start,
    endLine: end.line,
    end: end.end,
    text: pieces.join(' '),
  };
}

/** Whole-word containment on quote words, for «is this already in the note». */
export function containsQuoteWords(haystack: string, needle: string): boolean {
  const words = quoteWords(needle).text;
  if (!words) return false;
  return ` ${quoteWords(haystack).text} `.includes(` ${words} `);
}
