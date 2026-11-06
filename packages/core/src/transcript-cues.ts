import type { VisitNoteQuote } from '@localmed/contracts';

/**
 * Word cues on a conversation transcript, shared by the psychiatric-status matcher (PSY1) and the
 * form-fill fallback (FORMFILL1). Lines are read as stored; every span points back into them.
 *
 * - A cue pattern is matched on the lower-cased line with «ё» read as «е», from the start of a
 *   word; `~` stands for the rest of the word.
 * - A statement is quoted as its clause, the part of the line between punctuation marks.
 * - A negation right before the words (up to three words, same clause) or right after them (up to
 *   two words) makes the statement a denial.
 * - A question on a topic is not a fact. When the reply starts with «да» or «нет», the answer
 *   decides, and the quote runs from the question to the answer. The reply is on the same line after
 *   the «?» when there is one there (turns joined by «—», as time-cut recognised speech has them),
 *   else on the next line. A sentence counts as a question
 *   when it ends with «?», or when it runs to the end of the line and the next line starts with a
 *   bare «да» / «нет» (recognised speech often loses the question mark).
 */

export const NEGATIONS_BEFORE: ReadonlySet<string> = new Set([
  'не',
  'нет',
  'ни',
  'без',
  'никогда',
  'никаких',
  'никакого',
  'никакой',
  'никакие',
  'отрицает',
  'отрицаю',
  'отрицал',
  'отрицала',
]);
const NEGATIONS_AFTER = new Set(['не', 'нет', 'никогда']);
const YES = /^(?:да|ага|угу|бывает|бывают|было|были|есть)(?![\p{L}\p{N}])/u;
const NO = /^(?:нет|неа|не[ат]?|никогда|ни разу)(?![\p{L}\p{N}])/u;
/** «[00:01–00:05] Врач:» or «Пациент:» at the start of a line. */
export const SPEAKER_PREFIX = /^\s*(?:\[[^\]]*\]\s*)?(?:[\p{L}\d ]{1,24}:\s*)?/u;
const CLAUSE_BREAK = /[.,;:!?…()[\]«»"—–]/u;
const SENTENCE_END = /[.!?…]/u;
const WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/** A cue pattern list as one global regular expression over folded lines. */
export function compileCuePatterns(patterns: readonly string[]): RegExp {
  const body = patterns.map((pattern) => pattern.replaceAll('~', '[а-я]*')).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})`, 'gu');
}

/** Lower case with «ё» as «е», one UTF-16 unit for one, so offsets stay the source's. */
export function foldTranscriptLine(line: string): string {
  let folded = '';
  for (const unit of line) {
    const lower = unit.toLowerCase();
    const one = lower.length === unit.length ? lower : unit;
    folded += one === 'ё' ? 'е' : one;
  }
  return folded;
}

/** The clause around `[start, end)`: out to the nearest punctuation on both sides, trimmed. */
export function clauseAround(line: string, start: number, end: number): TextSpan {
  let from = start;
  while (from > 0 && !CLAUSE_BREAK.test(line[from - 1] as string)) from -= 1;
  let to = end;
  while (to < line.length && !CLAUSE_BREAK.test(line[to] as string)) to += 1;
  return trimSpan(line, from, to);
}

export function trimSpan(line: string, from: number, to: number): TextSpan {
  let start = from;
  let end = to;
  while (start < end && /\s/u.test(line[start] as string)) start += 1;
  while (end > start && /\s/u.test(line[end - 1] as string)) end -= 1;
  return { start, end };
}

export function cueWords(text: string): string[] {
  return [...text.matchAll(WORD)].map((match) => match[0]);
}

export function negatedAround(folded: string, clause: TextSpan, match: TextSpan): boolean {
  const own = cueWords(folded.slice(match.start, match.end));
  if (own.length > 0 && NEGATIONS_BEFORE.has(own[0] as string)) return false;
  const before = cueWords(folded.slice(clause.start, match.start)).slice(-3);
  if (before.some((word) => NEGATIONS_BEFORE.has(word))) return true;
  const after = cueWords(folded.slice(match.end, clause.end)).slice(0, 2);
  return after.some((word) => NEGATIONS_AFTER.has(word));
}

/** How the sentence around a match ends: «?», another mark, or not at all (the line runs out). */
export function sentenceEnding(folded: string, end: number): 'question' | 'statement' | 'open' {
  for (let at = end; at < folded.length; at += 1) {
    const character = folded[at] as string;
    if (SENTENCE_END.test(character)) return character === '?' ? 'question' : 'statement';
  }
  return 'open';
}

/** Where the sentence holding `start` begins, after any speaker label or dialogue dash. */
export function sentenceStart(folded: string, start: number): number {
  let from = start;
  while (from > 0 && !SENTENCE_END.test(folded[from - 1] as string)) from -= 1;
  const prefix = SPEAKER_PREFIX.exec(folded.slice(from, start))?.[0].length ?? 0;
  // A dialogue dash opens a turn; the quote starts at the words.
  const dash = /^[—–-]\s*/u.exec(folded.slice(from + prefix, start))?.[0].length ?? 0;
  return from + prefix + dash;
}

/** Where the sentence holding `end` stops: its closing mark included, trailing space not. */
export function sentenceEnd(folded: string, end: number): number {
  let to = end;
  while (to < folded.length && !SENTENCE_END.test(folded[to] as string)) to += 1;
  return trimSpan(folded, 0, to).end;
}

export interface CueAnswer {
  readonly line: number;
  readonly yes: boolean;
  /** Where the answer word starts, after any speaker label. */
  readonly start: number;
  /** End of the answer's first clause. */
  readonly end: number;
}

/** The line, after any speaker label, opens with a bare «нет» («Нет.», «Нет, не было», «Никогда»). */
export function opensWithNo(line: string): boolean {
  const folded = foldTranscriptLine(line);
  const offset = SPEAKER_PREFIX.exec(folded)?.[0].length ?? 0;
  return NO.test(folded.slice(offset));
}

/**
 * Where the reply to a question starts when it is on the question's own line: right after the «?»
 * that ends the question at `from`, past a dialogue dash («Голоса слышите?— Нет.»). Speech
 * recognisers that cut the audio by time put several turns on one line, the turns split by «—».
 */
function sameLineReply(folded: string, from: number): number | undefined {
  const mark = folded.indexOf('?', from);
  if (mark < 0) return undefined;
  const gap = /^[\s"»“]*(?:[—–-][\s"«„]*)?/u.exec(folded.slice(mark + 1))?.[0].length ?? 0;
  const start = mark + 1 + gap;
  return start < folded.length && /[\p{L}\p{N}]/u.test(folded[start] as string) ? start : undefined;
}

function yesNoAt(text: string, line: number, offset: number): CueAnswer | undefined {
  const rest = text.slice(offset);
  const yes = YES.exec(rest);
  const no = yes ? null : NO.exec(rest);
  const word = yes ?? no;
  if (!word) return undefined;
  const clause = clauseAround(text, offset, offset + word[0].length);
  return { line, yes: Boolean(yes), start: offset, end: clause.end };
}

/**
 * A bare «да» / «нет» answering the question that holds `from`: on the same line after its «?»
 * when a reply follows there, else at the start of the next non-empty line, after any speaker label.
 */
export function answerAfter(
  folded: readonly string[],
  line: number,
  from?: number,
): CueAnswer | undefined {
  if (from !== undefined) {
    const text = folded[line] as string;
    const same = sameLineReply(text, from);
    if (same !== undefined) return yesNoAt(text, line, same);
  }
  for (let next = line + 1; next < folded.length && next <= line + 2; next += 1) {
    const text = folded[next] as string;
    if (!text.trim()) continue;
    return yesNoAt(text, next, SPEAKER_PREFIX.exec(text)?.[0].length ?? 0);
  }
  return undefined;
}

/** Where the reply to the question holding `from` starts: on its line after the «?», or the next line. */
export function replyAfter(
  folded: readonly string[],
  line: number,
  from?: number,
): { readonly line: number; readonly start: number } | undefined {
  if (from !== undefined) {
    const same = sameLineReply(folded[line] as string, from);
    if (same !== undefined) return { line, start: same };
  }
  for (let next = line + 1; next < folded.length && next <= line + 2; next += 1) {
    const text = folded[next] as string;
    if (!text.trim()) continue;
    return { line: next, start: SPEAKER_PREFIX.exec(text)?.[0].length ?? 0 };
  }
  return undefined;
}

/** A transcript quote over `[startLine:start, endLine:end)` in the source's own wording. */
export function transcriptQuote(
  lines: readonly string[],
  startLine: number,
  start: number,
  endLine: number,
  end: number,
): VisitNoteQuote & { readonly source: 'transcript' } {
  const pieces: string[] = [];
  for (let line = startLine; line <= endLine; line += 1) {
    const value = lines[line] as string;
    const piece = value
      .slice(line === startLine ? start : 0, line === endLine ? end : value.length)
      .trim();
    if (piece) pieces.push(piece);
  }
  return { source: 'transcript', startLine, start, endLine, end, text: pieces.join(' ') };
}

export function sameQuoteSpan(a: VisitNoteQuote, b: VisitNoteQuote): boolean {
  return (
    a.startLine === b.startLine && a.start === b.start && a.endLine === b.endLine && a.end === b.end
  );
}
