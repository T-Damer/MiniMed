import {
  FORM_FILL_SCHEMA_VERSION,
  type FormFillEvidence,
  type FormFillField,
  type FormFillForm,
  type FormFillMethod,
  type FormFillProposal,
  type FormFillRejection,
  type FormFillRejectionCode,
  type FormFillResult,
  type FormFillValue,
  type VisitNoteQuote,
} from '@localmed/contracts';

import { NEGATIONS_BEFORE, opensWithNo, sameQuoteSpan, transcriptQuote } from '../transcript-cues';
import { locateLines } from '../visit-note-lines';
import {
  indexQuoteSource,
  locateQuote,
  type QuoteSourceIndex,
  quoteWords,
} from '../visit-note-quotes';
import { mentionsNumber, russianNumberWords } from './numbers';
import { speakerOfLine } from './speaker';

/**
 * Builds the filled-fields JSON from untrusted candidates (FORMFILL1), whoever proposed them. A
 * candidate keeps its value only when
 * 1. its field exists and the value fits the field type (options by label or value, numbers in
 *    range, ISO dates, «да»/«нет» for booleans);
 * 2. its citation passes SCRIBE1's quote check: cited line numbers (`locateLines`), a verbatim quote
 *    (`locateQuote`), or a span the cue matcher took from the transcript itself;
 * 3. the quoted words carry the value where that can be checked: a number must be said in the quote
 *    (digits or words), a «нет» must stand on a quote that has a negation in it.
 * Values for one field merge: the same value adds its quote (three at most), a multi-choice adds its
 * options, a different value is dropped as `conflicting-value` (the first one stays).
 */

export const FORM_FILL_MAX_EVIDENCE = 3;

export type FormFillCitation =
  | { readonly kind: 'lines'; readonly lines: unknown }
  | { readonly kind: 'quote'; readonly quote: unknown }
  | { readonly kind: 'span'; readonly quote: VisitNoteQuote };

export interface FormFillCandidate {
  readonly fieldId: string;
  readonly value: unknown;
  readonly citation: FormFillCitation;
}

type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: FormFillRejectionCode };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const RU_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u;
const YES_WORDS = new Set(['да', 'есть', 'yes', 'true', 'имеется', 'был', 'была', 'было', 'были']);
const NO_WORDS = new Set(['нет', 'no', 'false', 'отсутствует', 'не было']);

function fold(value: string): string {
  return value.trim().toLowerCase().replaceAll('ё', 'е');
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function optionValue(field: FormFillField, value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const wanted = fold(String(value));
  const option =
    field.options?.find((candidate) => fold(candidate.label) === wanted) ??
    field.options?.find((candidate) => fold(candidate.value) === wanted);
  return option?.value ?? null;
}

/** The value in the field's own terms, or why it does not fit. */
export function normalizeFormFillValue(
  field: FormFillField,
  value: unknown,
): Checked<FormFillValue> {
  switch (field.type) {
    case 'text': {
      if (typeof value !== 'string' || !value.trim()) return { ok: false, code: 'invalid-value' };
      const text = value.trim().replace(/\s+/gu, ' ');
      if (text.length > (field.maxLength ?? 2_000)) return { ok: false, code: 'invalid-value' };
      return { ok: true, value: text };
    }
    case 'number': {
      const number =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && /^-?\d+(?:[.,]\d+)?$/u.test(value.trim())
            ? Number(value.trim().replace(',', '.'))
            : Number.NaN;
      if (!Number.isFinite(number)) return { ok: false, code: 'invalid-value' };
      if (field.integer && !Number.isInteger(number)) return { ok: false, code: 'invalid-value' };
      if (
        (field.minimum !== undefined && number < field.minimum) ||
        (field.maximum !== undefined && number > field.maximum)
      ) {
        return { ok: false, code: 'out-of-range' };
      }
      return { ok: true, value: number };
    }
    case 'date': {
      if (typeof value !== 'string') return { ok: false, code: 'invalid-value' };
      const iso = ISO_DATE.exec(value.trim());
      const ru = iso ? null : RU_DATE.exec(value.trim());
      const parts = iso ? [iso[1], iso[2], iso[3]] : ru ? [ru[3], ru[2], ru[1]] : null;
      const date = parts ? isoDate(Number(parts[0]), Number(parts[1]), Number(parts[2])) : null;
      return date ? { ok: true, value: date } : { ok: false, code: 'invalid-value' };
    }
    case 'choice': {
      const option = optionValue(field, value);
      return option ? { ok: true, value: option } : { ok: false, code: 'option-not-allowed' };
    }
    case 'multi-choice': {
      const items = Array.isArray(value) ? value : [value];
      const options = items.map((item) => optionValue(field, item));
      if (options.length === 0 || options.some((option) => option === null)) {
        return { ok: false, code: 'option-not-allowed' };
      }
      const ordered = (field.options ?? [])
        .map((option) => option.value)
        .filter((option) => options.includes(option));
      return { ok: true, value: ordered };
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      if (typeof value === 'string' && YES_WORDS.has(fold(value))) return { ok: true, value: true };
      if (typeof value === 'string' && NO_WORDS.has(fold(value))) return { ok: true, value: false };
      return { ok: false, code: 'invalid-value' };
    }
  }
}

/** A value as the doctor reads it: option labels, «Да»/«Нет», the number, the text. */
export function formFillValueLabel(field: FormFillField, value: FormFillValue): string {
  if (field.type === 'boolean') return value ? 'Да' : 'Нет';
  if (field.type === 'number') return String(value).replace('.', ',');
  return formFillValueText(field, value);
}

/** How a value reads in words, for the label/value statement the line check compares with lines. */
export function formFillValueText(field: FormFillField, value: FormFillValue): string {
  if (field.type === 'boolean') return value ? 'да' : 'нет';
  if (field.type === 'choice' || field.type === 'multi-choice') {
    const values = Array.isArray(value) ? value : [String(value)];
    return (field.options ?? [])
      .filter((option) => values.includes(option.value))
      .map((option) => option.label)
      .join(', ');
  }
  if (field.type === 'number' && typeof value === 'number') {
    return [String(value), russianNumberWords(value)].filter(Boolean).join(' ');
  }
  return String(value);
}

/**
 * The statement cited lines must share a word with: the value itself for text; otherwise the field's
 * own label and hint, so the lines are about this field, plus the number in words and the chosen
 * options' wording. An option label several fields share is left out: «почти каждый день» answers
 * every PHQ-9 question alike and says nothing about which one. A «нет» value states its negation,
 * so a denial in the lines supports it.
 */
function statement(
  field: FormFillField,
  value: FormFillValue,
  sharedLabels: ReadonlySet<string>,
): string {
  if (field.type === 'text') return String(value);
  const valueWords =
    field.type === 'number' || field.type === 'choice' || field.type === 'multi-choice'
      ? formFillValueText(field, value)
          .split(', ')
          .filter((label) => !sharedLabels.has(fold(label)))
          .join(' ')
      : '';
  return [field.label, field.hint ?? '', valueWords, saysNo(field, value) ? 'нет' : ''].join(' ');
}

/** Option labels that more than one field offers (a questionnaire's answer scale). */
function sharedOptionLabels(form: FormFillForm): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const field of form.fields) {
    for (const label of new Set((field.options ?? []).map((option) => fold(option.label)))) {
      if (seen.has(label)) shared.add(label);
      seen.add(label);
    }
  }
  return shared;
}

function saysNo(field: FormFillField, value: FormFillValue): boolean {
  if (field.type === 'boolean') return value === false;
  if (field.type !== 'choice') return false;
  const label = field.options?.find((option) => option.value === value)?.label;
  return label !== undefined && NO_WORDS.has(fold(label));
}

function saysYes(field: FormFillField, value: FormFillValue): boolean {
  if (field.type === 'boolean') return value === true;
  if (field.type !== 'choice') return false;
  const label = field.options?.find((option) => option.value === value)?.label;
  return label !== undefined && YES_WORDS.has(fold(label));
}

function hasNegation(text: string): boolean {
  return quoteWords(text)
    .text.split(' ')
    .some((word) => NEGATIONS_BEFORE.has(word) || word === 'неа');
}

/** The value has to be readable in the quote where words can show it. */
function valueInQuote(
  field: FormFillField,
  value: FormFillValue,
  quote: VisitNoteQuote,
  lastLine: string,
): boolean {
  // A question nobody answered in the quote is not a fact («Мысли навредить себе?»).
  if (lastLine.trim().endsWith('?')) return false;
  if (field.type === 'number' && typeof value === 'number')
    return mentionsNumber(quote.text, value);
  if (saysNo(field, value)) return hasNegation(quote.text);
  // «Инфаркт переносили? — Нет»: the question shares the words, the answer takes them back.
  if (saysYes(field, value)) return !opensWithNo(lastLine);
  return true;
}

/**
 * One cited line right after a line that ends with «?» is read as that question's answer: models cite
 * the answer («Почти каждый день») without the question that says what it answers.
 */
function withQuestion(transcript: readonly string[], lines: unknown): unknown {
  const single = Array.isArray(lines) && lines.length === 1 ? lines[0] : lines;
  if (typeof single !== 'number' || !Number.isInteger(single) || single < 2) return lines;
  const question = transcript[single - 2]?.trim() ?? '';
  return question.endsWith('?') ? [single - 1, single] : lines;
}

function locate(
  transcript: readonly string[],
  index: QuoteSourceIndex,
  citation: FormFillCitation,
  field: FormFillField,
  value: FormFillValue,
  sharedLabels: ReadonlySet<string>,
): Checked<VisitNoteQuote> {
  if (citation.kind === 'lines') {
    if (citation.lines === undefined || citation.lines === null) {
      return { ok: false, code: 'missing-citation' };
    }
    const found = locateLines(
      { transcript },
      withQuestion(transcript, citation.lines),
      statement(field, value, sharedLabels),
    );
    return found.ok ? { ok: true, value: found.quote } : { ok: false, code: found.code };
  }
  if (citation.kind === 'quote') {
    if (typeof citation.quote !== 'string' || !citation.quote.trim()) {
      return { ok: false, code: 'missing-citation' };
    }
    const found = locateQuote(index, citation.quote);
    return found.ok ? { ok: true, value: found.quote } : { ok: false, code: found.code };
  }
  const { quote } = citation;
  const inRange =
    quote.startLine >= 0 &&
    quote.endLine < transcript.length &&
    quote.startLine <= quote.endLine &&
    quote.text.length > 0;
  const same =
    inRange &&
    transcriptQuote(transcript, quote.startLine, quote.start, quote.endLine, quote.end).text ===
      quote.text;
  return same ? { ok: true, value: quote } : { ok: false, code: 'quote-not-found' };
}

function sameValue(a: FormFillValue, b: FormFillValue): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, at) => item === b[at]);
  return a === b;
}

function evidenceFor(transcript: readonly string[], quote: VisitNoteQuote): FormFillEvidence {
  return { quote, speaker: speakerOfLine(transcript[quote.endLine] ?? '') };
}

export function buildFormFillResult(
  form: FormFillForm,
  transcript: readonly string[],
  candidates: readonly FormFillCandidate[],
  method: FormFillMethod,
): FormFillResult {
  // Maps, not objects: field ids reach here from model output, and «__proto__» must stay a key.
  const fields = new Map(form.fields.map((field) => [field.id, field]));
  const filled = new Map<string, FormFillProposal>();
  const rejected: FormFillRejection[] = [];
  const index = indexQuoteSource('transcript', transcript);
  const sharedLabels = sharedOptionLabels(form);
  const reject = (code: FormFillRejectionCode, fieldId?: string) =>
    rejected.push(fieldId === undefined ? { code } : { fieldId, code });

  for (const candidate of candidates) {
    const field = fields.get(candidate.fieldId);
    if (!field) {
      reject('unknown-field');
      continue;
    }
    const value = normalizeFormFillValue(field, candidate.value);
    if (!value.ok) {
      reject(value.code, field.id);
      continue;
    }
    const quote = locate(transcript, index, candidate.citation, field, value.value, sharedLabels);
    if (!quote.ok) {
      reject(quote.code, field.id);
      continue;
    }
    if (!valueInQuote(field, value.value, quote.value, transcript[quote.value.endLine] ?? '')) {
      reject('value-not-in-quote', field.id);
      continue;
    }
    const evidence = evidenceFor(transcript, quote.value);
    const current = filled.get(field.id);
    if (!current) {
      filled.set(field.id, { value: value.value, evidence: [evidence], origin: method });
      continue;
    }
    const merged =
      field.type === 'multi-choice'
        ? (field.options ?? [])
            .map((option) => option.value)
            .filter(
              (option) =>
                (current.value as string[]).includes(option) ||
                (value.value as string[]).includes(option),
            )
        : current.value;
    if (field.type !== 'multi-choice' && !sameValue(current.value, value.value)) {
      reject('conflicting-value', field.id);
      continue;
    }
    const known = current.evidence.some((existing) =>
      sameQuoteSpan(existing.quote, evidence.quote),
    );
    filled.set(field.id, {
      ...current,
      value: merged,
      evidence:
        known || current.evidence.length >= FORM_FILL_MAX_EVIDENCE
          ? current.evidence
          : [...current.evidence, evidence],
    });
  }

  return {
    schemaVersion: FORM_FILL_SCHEMA_VERSION,
    formId: form.id,
    method,
    fields: Object.fromEntries(
      form.fields.map((field) => [field.id, filled.get(field.id) ?? null]),
    ),
    rejected,
  };
}
