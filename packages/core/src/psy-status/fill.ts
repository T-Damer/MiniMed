import type { PsyStatusCueKind, PsyStatusQuote, PsyStatusSuggestion } from '@localmed/contracts';
import {
  answerAfter,
  clauseAround,
  compileCuePatterns,
  foldTranscriptLine,
  negatedAround,
  sameQuoteSpan,
  sentenceEnding,
  sentenceStart,
  transcriptQuote,
} from '../transcript-cues';
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

interface CompiledCue {
  readonly cue: PsyStatusCue;
  readonly pattern: RegExp;
}

const COMPILED: readonly CompiledCue[] = PSY_STATUS_CUES.map((cue) => ({
  cue,
  pattern: compileCuePatterns(cue.words),
}));

/** Lower case with «ё» as «е», one UTF-16 unit for one, so offsets stay the source's. */
export const foldPsyStatusLine = foldTranscriptLine;

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
    const answer = ending === 'statement' ? undefined : answerAfter(folded, line, span.end);
    if (ending === 'question' || answer) {
      if (!answer) continue;
      const code = answer.yes ? compiled.cue.code : compiled.cue.denied;
      if (!code) continue;
      found.push({
        code,
        kind: 'answer',
        quote: transcriptQuote(
          lines,
          line,
          sentenceStart(text, span.start),
          answer.line,
          answer.end,
        ),
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
      quote: transcriptQuote(lines, line, clause.start, line, clause.end),
    });
  }
  return found;
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
          !current.quotes.some((existing) => sameQuoteSpan(existing, found.quote))
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
  return transcriptQuote(lines, value.startLine, value.start, value.endLine, value.end).text;
}
