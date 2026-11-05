import type { FormFillField, FormFillForm, FormFillResult } from '@localmed/contracts';

import {
  answerAfter,
  clauseAround,
  compileCuePatterns,
  foldTranscriptLine,
  negatedAround,
  replyAfter,
  sentenceEnd,
  sentenceEnding,
  sentenceStart,
  type TextSpan,
  transcriptQuote,
  trimSpan,
} from '../transcript-cues';
import { spokenNumbers } from './numbers';
import { buildFormFillResult, type FormFillCandidate } from './result';

/**
 * The form filler without a model (FORMFILL1): word cues declared on the form-fill schema (field
 * `cues`, option `cues`) are matched line by line with PSY1's rules (`transcript-cues.ts`): a
 * statement is its clause, a denial is a negation next to the words, a question decides only with
 * the «да» / «нет» (or the number) that answers it on the next line. Per field type:
 *
 * - boolean: the words said → true, with a denial or answered «нет» → false;
 * - choice / multi-choice: an option's words said without a denial → that option (all of them for a
 *   multi-choice); a question answered «да» counts as said. A choice with its own words (a
 *   questionnaire item) takes an option only when it is said about that topic;
 * - number: the first number in the clause of the words, or at the start of the answer to a
 *   question with the words («Сколько вам лет? — Семьдесят два»);
 * - text: the rest of the sentence after the words, as said («Диагноз: …»);
 * - date: no cues (spoken dates are left to the model and the doctor).
 *
 * The candidates then pass the same checks as a model's (`buildFormFillResult`), quoted as spans of
 * the transcript itself. A form can bring its own matcher instead (PSY1's psychiatric status is one).
 */

interface Match {
  readonly line: number;
  readonly span: TextSpan;
}

function matches(folded: readonly string[], patterns: readonly string[]): Match[] {
  const pattern = compileCuePatterns(patterns);
  const found: Match[] = [];
  folded.forEach((text, line) => {
    for (const match of text.matchAll(pattern)) {
      found.push({ line, span: { start: match.index, end: match.index + match[0].length } });
    }
  });
  return found;
}

type Reading =
  | { readonly kind: 'said'; readonly negated: boolean; readonly clause: TextSpan }
  | {
      readonly kind: 'answered';
      readonly yes: boolean;
      readonly start: number;
      readonly answerLine: number;
      readonly answerEnd: number;
    }
  | { readonly kind: 'unanswered' };

function read(folded: readonly string[], match: Match): Reading {
  const text = folded[match.line] as string;
  const ending = sentenceEnding(text, match.span.end);
  const answer = ending === 'statement' ? undefined : answerAfter(folded, match.line);
  if (ending === 'question' || answer) {
    if (!answer) return { kind: 'unanswered' };
    return {
      kind: 'answered',
      yes: answer.yes,
      start: sentenceStart(text, match.span.start),
      answerLine: answer.line,
      answerEnd: answer.end,
    };
  }
  const clause = clauseAround(text, match.span.start, match.span.end);
  return { kind: 'said', negated: negatedAround(text, clause, match.span), clause };
}

function spanCandidate(
  lines: readonly string[],
  fieldId: string,
  value: unknown,
  startLine: number,
  start: number,
  endLine: number,
  end: number,
): FormFillCandidate {
  return {
    fieldId,
    value,
    citation: { kind: 'span', quote: transcriptQuote(lines, startLine, start, endLine, end) },
  };
}

function yesNo(
  lines: readonly string[],
  folded: readonly string[],
  field: FormFillField,
  cues: readonly string[],
  yesValue: (yes: boolean) => unknown | null,
) {
  const found: FormFillCandidate[] = [];
  for (const match of matches(folded, cues)) {
    const reading = read(folded, match);
    if (reading.kind === 'unanswered') continue;
    if (reading.kind === 'answered') {
      const value = yesValue(reading.yes);
      if (value === null) continue;
      found.push(
        spanCandidate(
          lines,
          field.id,
          value,
          match.line,
          reading.start,
          reading.answerLine,
          reading.answerEnd,
        ),
      );
      continue;
    }
    const value = yesValue(!reading.negated);
    if (value === null) continue;
    found.push(
      spanCandidate(
        lines,
        field.id,
        value,
        match.line,
        reading.clause.start,
        match.line,
        reading.clause.end,
      ),
    );
  }
  return found;
}

function numberCandidates(
  lines: readonly string[],
  folded: readonly string[],
  field: FormFillField,
): FormFillCandidate[] {
  const found: FormFillCandidate[] = [];
  for (const match of matches(folded, field.cues ?? [])) {
    const text = folded[match.line] as string;
    const ending = sentenceEnding(text, match.span.end);
    const clause = clauseAround(text, match.span.start, match.span.end);
    const said = spokenNumbers(text.slice(clause.start, clause.end))[0];
    if (said && ending !== 'question') {
      found.push(
        spanCandidate(
          lines,
          field.id,
          said.value,
          match.line,
          clause.start,
          match.line,
          clause.end,
        ),
      );
      continue;
    }
    if (ending === 'statement') continue;
    const reply = replyAfter(folded, match.line);
    if (!reply) continue;
    const answerText = folded[reply.line] as string;
    const answerClause = clauseAround(answerText, reply.start, reply.start);
    const number = spokenNumbers(answerText.slice(reply.start, answerClause.end))[0];
    // The answer has to open with the number: «Семьдесят два», not «Не помню, лет десять назад».
    if (number?.start !== 0) continue;
    found.push(
      spanCandidate(
        lines,
        field.id,
        number.value,
        match.line,
        sentenceStart(text, match.span.start),
        reply.line,
        answerClause.end,
      ),
    );
  }
  return found;
}

function textCandidates(
  lines: readonly string[],
  folded: readonly string[],
  field: FormFillField,
): FormFillCandidate[] {
  const found: FormFillCandidate[] = [];
  for (const match of matches(folded, field.cues ?? [])) {
    const text = folded[match.line] as string;
    if (sentenceEnding(text, match.span.end) === 'question') continue;
    const clause = clauseAround(text, match.span.start, match.span.end);
    if (negatedAround(text, clause, match.span)) continue;
    const end = sentenceEnd(text, match.span.end);
    let from = match.span.end;
    while (from < end && /[\s:—–-]/u.test(text[from] as string)) from += 1;
    const value = trimSpan(text, from, end);
    const source = (lines[match.line] as string)
      .slice(value.start, value.end)
      .replace(/[.!…]+$/u, '');
    if (source.trim().length < 3) continue;
    found.push(
      spanCandidate(
        lines,
        field.id,
        source,
        match.line,
        sentenceStart(text, match.span.start),
        match.line,
        end,
      ),
    );
  }
  return found;
}

function fieldCandidates(
  lines: readonly string[],
  folded: readonly string[],
  field: FormFillField,
): FormFillCandidate[] {
  switch (field.type) {
    case 'boolean':
      return field.cues ? yesNo(lines, folded, field, field.cues, (yes) => yes) : [];
    case 'choice':
      if (field.cues) return topicChoiceCandidates(lines, folded, field);
      return optionCandidates(lines, folded, field);
    case 'multi-choice':
      return optionCandidates(lines, folded, field);
    case 'number':
      return numberCandidates(lines, folded, field);
    case 'text':
      return textCandidates(lines, folded, field);
    case 'date':
      return [];
  }
}

function optionCandidates(
  lines: readonly string[],
  folded: readonly string[],
  field: FormFillField,
): FormFillCandidate[] {
  return (field.options ?? []).flatMap((option) =>
    option.cues
      ? yesNo(lines, folded, field, option.cues, (yes) =>
          yes ? (field.type === 'choice' ? option.value : [option.value]) : null,
        )
      : [],
  );
}

interface OptionMatch {
  readonly value: string;
  readonly start: number;
}

/** The earliest option said between `from` and `to` without a denial next to it. */
function firstOption(
  text: string,
  from: number,
  to: number,
  options: readonly { readonly value: string; readonly pattern: RegExp }[],
): OptionMatch | undefined {
  let best: OptionMatch | undefined;
  for (const option of options) {
    for (const match of text.slice(from, to).matchAll(option.pattern)) {
      const span = { start: from + match.index, end: from + match.index + match[0].length };
      if (negatedAround(text, clauseAround(text, span.start, span.end), span)) continue;
      if (!best || span.start < best.start) best = { value: option.value, start: span.start };
      break;
    }
  }
  return best;
}

/**
 * A choice tied to its topic, as a questionnaire item is: the field's words name the topic, an
 * option's words the answer, and only an answer to that topic counts — in the same sentence
 * («Сплю плохо почти каждый день») or opening the reply to a question on it («Со сном как? —
 * Несколько дней было»). The scale's words alone («почти каждый день») never fill an item.
 */
function topicChoiceCandidates(
  lines: readonly string[],
  folded: readonly string[],
  field: FormFillField,
): FormFillCandidate[] {
  const options = (field.options ?? []).flatMap((option) =>
    option.cues ? [{ value: option.value, pattern: compileCuePatterns(option.cues) }] : [],
  );
  if (options.length === 0) return [];
  const found: FormFillCandidate[] = [];
  for (const match of matches(folded, field.cues ?? [])) {
    const text = folded[match.line] as string;
    const start = sentenceStart(text, match.span.start);
    const end = sentenceEnd(text, match.span.end);
    const ending = sentenceEnding(text, match.span.end);
    if (ending !== 'question') {
      const said = firstOption(text, start, end, options);
      if (said) {
        found.push(spanCandidate(lines, field.id, said.value, match.line, start, match.line, end));
        continue;
      }
    }
    if (ending === 'statement') continue;
    const reply = replyAfter(folded, match.line);
    if (!reply) continue;
    const replyText = folded[reply.line] as string;
    const replyEnd = sentenceEnd(replyText, reply.start);
    const answer = firstOption(replyText, reply.start, replyEnd, options);
    if (!answer) continue;
    found.push(
      spanCandidate(lines, field.id, answer.value, match.line, start, reply.line, replyEnd),
    );
  }
  return found;
}

/** Candidates in transcript order, so the first value said is the one kept. */
export function formFillCueCandidates(
  form: FormFillForm,
  transcript: readonly string[],
): FormFillCandidate[] {
  const folded = transcript.map(foldTranscriptLine);
  return form.fields
    .flatMap((field) => fieldCandidates(transcript, folded, field))
    .map((candidate, order) => ({ candidate, order }))
    .sort((a, b) => {
      const qa = a.candidate.citation.kind === 'span' ? a.candidate.citation.quote : null;
      const qb = b.candidate.citation.kind === 'span' ? b.candidate.citation.quote : null;
      return (
        (qa?.startLine ?? 0) - (qb?.startLine ?? 0) ||
        (qa?.start ?? 0) - (qb?.start ?? 0) ||
        a.order - b.order
      );
    })
    .map(({ candidate }) => candidate);
}

/** True when the form declares word cues, so the fallback can fill something without a model. */
export function formFillHasCues(form: FormFillForm): boolean {
  return form.fields.some(
    (field) => Boolean(field.cues) || Boolean(field.options?.some((option) => option.cues)),
  );
}

export function fillFormWithCues(
  form: FormFillForm,
  transcript: readonly string[],
): FormFillResult {
  return buildFormFillResult(form, transcript, formFillCueCandidates(form, transcript), 'cues');
}
