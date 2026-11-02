import type { VisitNoteQuote, VisitNoteQuoteSource } from '@localmed/contracts';

import { NEGATIONS, quoteWords } from './visit-note-quotes';

/**
 * Line citations for the visit-note draft (SCRIBE1). Small local models paraphrase quotes (digits
 * for spoken numbers, other word forms), so a model may instead cite the numbered source lines a
 * statement comes from. The quote is then those lines in the source's own wording; the statement
 * must share a content word with them, so a wrong line number is caught, and a statement whose only
 * shared words are negated in the line («не кружится», «обмороков не было») is not taken as the
 * positive claim.
 * This proves where a statement was taken from, not that the lines say exactly that: the doctor
 * reads the quoted lines next to it.
 *
 * Lines are numbered from 1 over the transcript as stored, then on over the earlier record.
 */
export interface LineCitationSources {
  readonly transcript: readonly string[];
  readonly priorRecord?: readonly string[];
}

/** A question, its answer and one line between them. */
export const LINE_CITATION_MAX_SPAN = 3;

export type LineLocation =
  | { readonly ok: true; readonly quote: VisitNoteQuote }
  | {
      readonly ok: false;
      readonly code: 'line-not-found' | 'line-unrelated' | 'quote-negated';
    };

/** Frequent words of four letters or more that link a statement to any line. */
const LINK_STOPWORDS = new Set([
  'было',
  'была',
  'были',
  'будет',
  'есть',
  'когда',
  'только',
  'очень',
  'тоже',
  'если',
  'этот',
  'врач',
  'пациент',
  'пациентка',
  'мама',
  'папа',
]);

/** The number a source line carries in a line-cited prompt. */
export function visitNoteLineNumber(
  sources: LineCitationSources,
  source: VisitNoteQuoteSource,
  index: number,
): number {
  return (source === 'transcript' ? 0 : sources.transcript.length) + index + 1;
}

export function locateLines(
  sources: LineCitationSources,
  cited: unknown,
  statement: string,
): LineLocation {
  const span = citedSpan(sources, cited);
  if (!span) return { ok: false, code: 'line-not-found' };
  const statementWords = quoteWords(statement).text.split(' ');
  const stems = new Set(statementWords.filter(isContentWord).map(stem));
  let shared = 0;
  let negated = 0;
  for (let line = span.first; line <= span.last; line += 1) {
    const words = quoteWords(span.lines[line] as string).text.split(' ');
    words.forEach((word, position) => {
      if (!isContentWord(word) || !stems.has(stem(word))) return;
      shared += 1;
      if (negatedWord(words, position)) negated += 1;
    });
  }
  if (shared === 0) return { ok: false, code: 'line-unrelated' };
  if (negated === shared && !statementWords.some((word) => NEGATIONS.has(word))) {
    return { ok: false, code: 'quote-negated' };
  }
  return { ok: true, quote: spanQuote(span) };
}

interface CitedSpan {
  readonly source: VisitNoteQuoteSource;
  readonly lines: readonly string[];
  readonly first: number;
  readonly last: number;
}

/** One line number, or up to three numbers within one source and three lines of each other. */
function citedSpan(sources: LineCitationSources, cited: unknown): CitedSpan | null {
  const numbers = (Array.isArray(cited) ? cited : [cited]).map(lineNumber);
  if (numbers.length === 0 || numbers.length > LINE_CITATION_MAX_SPAN) return null;
  if (numbers.some((number) => number === null)) return null;
  const transcriptLines = sources.transcript.length;
  const from = Math.min(...(numbers as number[]));
  const to = Math.max(...(numbers as number[]));
  if (to - from >= LINE_CITATION_MAX_SPAN) return null;
  const inTranscript = from <= transcriptLines;
  if (inTranscript !== to <= transcriptLines) return null;
  const lines = inTranscript ? sources.transcript : (sources.priorRecord ?? []);
  const offset = inTranscript ? 1 : transcriptLines + 1;
  const first = from - offset;
  const last = to - offset;
  if (first < 0 || last >= lines.length) return null;
  if (!lines[first]?.trim() || !lines[last]?.trim()) return null;
  return { source: inTranscript ? 'transcript' : 'prior-record', lines, first, last };
}

function lineNumber(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/u.test(value.trim()) ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
}

function spanQuote(span: CitedSpan): VisitNoteQuote {
  const firstLine = span.lines[span.first] as string;
  const lastLine = span.lines[span.last] as string;
  const pieces = span.lines
    .slice(span.first, span.last + 1)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    source: span.source,
    startLine: span.first,
    start: firstLine.length - firstLine.trimStart().length,
    endLine: span.last,
    end: lastLine.trimEnd().length,
    text: pieces.join(' '),
  };
}

/**
 * A negation right before the word, or «не» / «нет» within the next two («отёков нет», «обмороков не
 * было»). A false hit only drops the statement.
 */
function negatedWord(words: readonly string[], position: number): boolean {
  if (position > 0 && NEGATIONS.has(words[position - 1] as string)) return true;
  return words.slice(position + 1, position + 3).some((word) => word === 'не' || word === 'нет');
}

function isContentWord(word: string): boolean {
  return (word.length >= 4 && !LINK_STOPWORDS.has(word)) || /\d/u.test(word);
}

/** Russian endings change within a word's first five letters only rarely. */
function stem(word: string): string {
  return word.slice(0, 5);
}
