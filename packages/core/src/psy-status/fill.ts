import type { PsyStatusCueKind, PsyStatusQuote, PsyStatusSuggestion } from '@localmed/contracts';

import { psyStatusPhrase } from './catalog';
import { PSY_STATUS_CUES, type PsyStatusCue } from './cues';

/**
 * Proposes psychiatric-status phrases from a conversation transcript (PSY1). Deterministic and
 * offline: the cues in `cues.ts` are matched line by line, and every proposal carries the
 * transcript words it stands on, as a located quote into the lines exactly as stored. The doctor
 * accepts or turns down each proposal; nothing is filled without that.
 *
 * - A statement («слышу голоса», «аллергии нет») is quoted as its clause, the part of the line
 *   between punctuation marks.
 * - A negation right before the words (up to three words, same clause) or right after them (up to
 *   two words) makes it a denial; a cue without a denial phrase then proposes nothing.
 * - A question on a topic («Голоса слышите?») is not a fact. When the next line starts with «да» or
 *   «нет», the answer proposes the phrase and the quote runs from the question to the answer.
 *   A sentence counts as a question when it ends with «?», or when it runs to the end of the line
 *   without a full stop and the next line starts with a bare «да» / «нет» (recognised speech often
 *   loses the question mark).
 */

/** Quotes kept per proposal: enough to show it was said more than once. */
export const PSY_STATUS_MAX_QUOTES = 3;

const NEGATIONS_BEFORE = new Set([
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
const SPEAKER_PREFIX = /^\s*(?:\[[^\]]*\]\s*)?(?:[\p{L}\d ]{1,24}:\s*)?/u;
const CLAUSE_BREAK = /[.,;:!?…()[\]«»"—–]/u;
const SENTENCE_END = /[.!?…]/u;
const WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;

interface CompiledCue {
  readonly cue: PsyStatusCue;
  readonly pattern: RegExp;
}

function compile(cue: PsyStatusCue): CompiledCue {
  const body = cue.words.map((word) => word.replaceAll('~', '[а-я]*')).join('|');
  return { cue, pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})`, 'gu') };
}

const COMPILED = PSY_STATUS_CUES.map(compile);

/** Lower case with «ё» as «е», one UTF-16 unit for one, so offsets stay the source's. */
export function foldPsyStatusLine(line: string): string {
  let folded = '';
  for (const unit of line) {
    const lower = unit.toLowerCase();
    const one = lower.length === unit.length ? lower : unit;
    folded += one === 'ё' ? 'е' : one;
  }
  return folded;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

/** The clause around `[start, end)`: out to the nearest punctuation on both sides, trimmed. */
function clauseAround(line: string, start: number, end: number): Span {
  let from = start;
  while (from > 0 && !CLAUSE_BREAK.test(line[from - 1] as string)) from -= 1;
  let to = end;
  while (to < line.length && !CLAUSE_BREAK.test(line[to] as string)) to += 1;
  return trimSpan(line, from, to);
}

function trimSpan(line: string, from: number, to: number): Span {
  let start = from;
  let end = to;
  while (start < end && /\s/u.test(line[start] as string)) start += 1;
  while (end > start && /\s/u.test(line[end - 1] as string)) end -= 1;
  return { start, end };
}

function words(text: string): string[] {
  return [...text.matchAll(WORD)].map((match) => match[0]);
}

function negatedAround(folded: string, clause: Span, match: Span): boolean {
  const own = words(folded.slice(match.start, match.end));
  if (own.length > 0 && NEGATIONS_BEFORE.has(own[0] as string)) return false;
  const before = words(folded.slice(clause.start, match.start)).slice(-3);
  if (before.some((word) => NEGATIONS_BEFORE.has(word))) return true;
  const after = words(folded.slice(match.end, clause.end)).slice(0, 2);
  return after.some((word) => NEGATIONS_AFTER.has(word));
}

/** How the sentence around a match ends: «?», another mark, or not at all (the line runs out). */
function sentenceEnding(folded: string, end: number): 'question' | 'statement' | 'open' {
  for (let at = end; at < folded.length; at += 1) {
    const character = folded[at] as string;
    if (SENTENCE_END.test(character)) return character === '?' ? 'question' : 'statement';
  }
  return 'open';
}

function sentenceStart(folded: string, start: number): number {
  let from = start;
  while (from > 0 && !SENTENCE_END.test(folded[from - 1] as string)) from -= 1;
  const prefix = SPEAKER_PREFIX.exec(folded.slice(from, start))?.[0].length ?? 0;
  return from + prefix;
}

interface Answer {
  readonly line: number;
  readonly yes: boolean;
  readonly end: number;
}

/** A bare «да» / «нет» at the start of the next non-empty line, after any speaker label. */
function answerAfter(folded: readonly string[], line: number): Answer | undefined {
  for (let next = line + 1; next < folded.length && next <= line + 2; next += 1) {
    const text = folded[next] as string;
    if (!text.trim()) continue;
    const offset = SPEAKER_PREFIX.exec(text)?.[0].length ?? 0;
    const rest = text.slice(offset);
    const yes = YES.exec(rest);
    const no = yes ? null : NO.exec(rest);
    const word = yes ?? no;
    if (!word) return undefined;
    const clause = clauseAround(text, offset, offset + word[0].length);
    return { line: next, yes: Boolean(yes), end: clause.end };
  }
  return undefined;
}

function quote(
  lines: readonly string[],
  startLine: number,
  start: number,
  endLine: number,
  end: number,
): PsyStatusQuote {
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

interface Found {
  readonly code: string;
  readonly kind: PsyStatusCueKind;
  readonly quote: PsyStatusQuote;
}

function findInLine(
  lines: readonly string[],
  folded: readonly string[],
  line: number,
  compiled: CompiledCue,
): Found[] {
  const text = folded[line] as string;
  const found: Found[] = [];
  for (const match of text.matchAll(compiled.pattern)) {
    const span = { start: match.index, end: match.index + match[0].length };
    const ending = sentenceEnding(text, span.end);
    const answer = ending === 'statement' ? undefined : answerAfter(folded, line);
    if (ending === 'question' || answer) {
      if (!answer) continue;
      const code = answer.yes ? compiled.cue.code : compiled.cue.denied;
      if (!code) continue;
      found.push({
        code,
        kind: 'answer',
        quote: quote(lines, line, sentenceStart(text, span.start), answer.line, answer.end),
      });
      continue;
    }
    const clause = clauseAround(text, span.start, span.end);
    const negated = negatedAround(text, clause, span);
    const code = negated ? compiled.cue.denied : compiled.cue.code;
    if (!code) continue;
    found.push({
      code,
      kind: negated ? 'denial' : 'statement',
      quote: quote(lines, line, clause.start, line, clause.end),
    });
  }
  return found;
}

function sameSpan(a: PsyStatusQuote, b: PsyStatusQuote): boolean {
  return (
    a.startLine === b.startLine && a.start === b.start && a.endLine === b.endLine && a.end === b.end
  );
}

/**
 * Proposals in transcript order, one per phrase, each with up to `PSY_STATUS_MAX_QUOTES` quotes.
 * A phrase and its opposite may both be proposed (the patient denied, then told); the quality
 * check of the status names the contradiction.
 */
export function fillPsyStatusFromTranscript(
  lines: readonly string[],
): readonly PsyStatusSuggestion[] {
  const folded = lines.map(foldPsyStatusLine);
  const byCode = new Map<string, PsyStatusSuggestion>();
  for (let line = 0; line < lines.length; line += 1) {
    for (const compiled of COMPILED) {
      for (const found of findInLine(lines, folded, line, compiled)) {
        const ref = psyStatusPhrase(found.code);
        if (!ref) continue;
        const current = byCode.get(found.code);
        if (!current) {
          byCode.set(found.code, {
            code: found.code,
            moduleId: ref.module.id,
            sectionId: ref.section.id,
            kind: found.kind,
            quotes: [found.quote],
          });
        } else if (
          current.quotes.length < PSY_STATUS_MAX_QUOTES &&
          !current.quotes.some((existing) => sameSpan(existing, found.quote))
        ) {
          byCode.set(found.code, { ...current, quotes: [...current.quotes, found.quote] });
        }
      }
    }
  }
  return [...byCode.values()].sort((a, b) => {
    const qa = a.quotes[0] as PsyStatusQuote;
    const qb = b.quotes[0] as PsyStatusQuote;
    return qa.startLine - qb.startLine || qa.start - qb.start;
  });
}

/** The quote's words as they stand in the transcript, for showing and for checking it. */
export function psyStatusQuoteSource(lines: readonly string[], value: PsyStatusQuote): string {
  return quote(lines, value.startLine, value.start, value.endLine, value.end).text;
}
