import type { FormFillField, FormFillForm, FormFillResult } from '@localmed/contracts';

import { visitNoteLineNumber } from '../visit-note-lines';
import {
  splitVisitNoteWindows,
  VISIT_NOTE_WINDOW_CHARS,
  type VisitNoteCitation,
} from '../visit-note-model';
import { QUOTE_MIN_CHARS } from '../visit-note-quotes';
import { buildFormFillResult, type FormFillCandidate } from './result';

/**
 * Local-model pass of the form filler (FORMFILL1). The transcript goes to the model window by
 * window (SCRIBE1's windows: whole numbered lines, 1 600 characters, a short last line carried
 * over), and every window is asked about a few fields at a time — one section, cut into chunks of
 * `fieldsPerCall` — so a small model never weighs the whole form at once. Each call carries a JSON
 * Schema built from those fields: the runtime constrains generation to it (llama.cpp grammar), so
 * the answer always parses, a choice is one of the option labels, and a cited line is one of the
 * window's line numbers. Every key is required and may be `null`: abstaining is always on offer.
 * The answers then go through `buildFormFillResult`, which keeps only typed values on located quotes.
 */

/** A JSON Schema object (draft 2020-12 subset that llama.cpp's grammar converter reads). */
export type FormFillJsonSchema = Readonly<Record<string, unknown>>;

export interface FormFillModelRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens: number;
  /** The answer must be one JSON value of this schema. */
  readonly responseSchema: FormFillJsonSchema;
}

/** Port to whichever local model runs on the device; resolves with the parsed answer or null. */
export interface FormFillModel {
  complete(request: FormFillModelRequest): Promise<unknown>;
}

export interface FormFillModelOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
  readonly windowChars?: number;
  /** Fields per call; the default keeps prompt, window and answer inside a 2 048-token context. */
  readonly fieldsPerCall?: number;
  /** Line numbers (default) or verbatim quotes, as in SCRIBE1. */
  readonly citation?: VisitNoteCitation;
}

export interface FormFillModelRun {
  readonly result: FormFillResult;
  readonly calls: number;
  /** Calls whose answer was not a JSON object; they add nothing. */
  readonly unreadableCalls: number;
  /** Non-null values the model proposed, before any check. */
  readonly proposed: number;
}

export const FORM_FILL_FIELDS_PER_CALL = 4;
const TOKENS_PER_FIELD = 70;
const MAX_ANSWER_TOKENS = 512;
const QUOTE_MAX_CHARS = 200;

/** Sections cut into chunks of at most `size` fields, in form order. */
export function formFillChunks(
  form: FormFillForm,
  size = FORM_FILL_FIELDS_PER_CALL,
): FormFillField[][] {
  const byId = new Map(form.fields.map((field) => [field.id, field]));
  const chunks: FormFillField[][] = [];
  for (const section of form.sections) {
    const fields = section.fieldIds
      .map((id) => byId.get(id))
      .filter((field) => field !== undefined);
    for (let at = 0; at < fields.length; at += size) chunks.push(fields.slice(at, at + size));
  }
  return chunks;
}

function valueSchema(field: FormFillField): FormFillJsonSchema {
  switch (field.type) {
    case 'text':
      return { type: 'string', minLength: 1, maxLength: Math.min(field.maxLength ?? 300, 300) };
    case 'number':
      return {
        type: field.integer ? 'integer' : 'number',
        ...(field.minimum !== undefined ? { minimum: field.minimum } : {}),
        ...(field.maximum !== undefined ? { maximum: field.maximum } : {}),
      };
    case 'date':
      return { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };
    case 'choice':
      return { type: 'string', enum: (field.options ?? []).map((option) => option.label) };
    case 'multi-choice':
      return {
        type: 'array',
        items: { type: 'string', enum: (field.options ?? []).map((option) => option.label) },
        minItems: 1,
        maxItems: field.options?.length ?? 1,
        uniqueItems: true,
      };
    case 'boolean':
      return { type: 'boolean' };
  }
}

/** The schema of one answer: every field a key, each `null` or `{value, lines|quote}`. */
export function formFillResponseSchema(
  fields: readonly FormFillField[],
  lineNumbers: readonly number[],
  citation: VisitNoteCitation = 'line',
): FormFillJsonSchema {
  const cite: FormFillJsonSchema =
    citation === 'line'
      ? {
          type: 'array',
          items: { type: 'integer', enum: [...lineNumbers] },
          minItems: 1,
          maxItems: 3,
        }
      : { type: 'string', minLength: QUOTE_MIN_CHARS, maxLength: QUOTE_MAX_CHARS };
  const citeKey = citation === 'line' ? 'lines' : 'quote';
  return {
    type: 'object',
    additionalProperties: false,
    required: fields.map((field) => field.id),
    properties: Object.fromEntries(
      fields.map((field) => [
        field.id,
        {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['value', citeKey],
              properties: { value: valueSchema(field), [citeKey]: cite },
            },
          ],
        },
      ]),
    ),
  };
}

const TYPE_GUIDE: Readonly<Record<FormFillField['type'], string>> = {
  text: 'текст, кратко, словами из беседы',
  number: 'число цифрами',
  date: 'дата ГГГГ-ММ-ДД',
  choice: 'один вариант',
  'multi-choice': 'список вариантов',
  boolean: 'true — да, false — нет',
};

function fieldGuide(field: FormFillField): string {
  const parts = [TYPE_GUIDE[field.type]];
  if (field.options)
    parts.push(`варианты: ${field.options.map((option) => `«${option.label}»`).join(', ')}`);
  if (field.hint) parts.push(field.hint);
  return `- ${field.id} — ${field.label} (${parts.join('; ')})`;
}

const CITATION_RULES: Readonly<Record<VisitNoteCitation, string>> = {
  line: 'Строки текста пронумерованы: «номер| строка». Для поля, о котором сказано, верни {"value": значение, "lines": [номера строк, где это сказано]}. Если ответ пациента понятен только с вопросом врача, укажи обе строки.',
  quote:
    'Для поля, о котором сказано, верни {"value": значение, "quote": "точные слова из текста, 3–12 слов подряд"}.',
};

export function formFillSystemPrompt(
  form: FormFillForm,
  fields: readonly FormFillField[],
  citation: VisitNoteCitation = 'line',
): string {
  return [
    `Ты заполняешь поля формы «${form.title}» по записи приёма. Не рассуждай. Верни только один JSON-объект с ключами полей.`,
    `Поля:\n${fields.map(fieldGuide).join('\n')}`,
    CITATION_RULES[citation],
    'Если о поле в этом фрагменте не говорили или ответ неясен, верни null. Не додумывай: значение должно прямо следовать из этих слов. Вопрос врача без ответа — не факт.',
  ].join('\n\n');
}

export function formFillUserPrompt(window: string, position: number, total: number): string {
  return `Запись приёма, реплики врача и пациента, фрагмент ${position} из ${total}:\n\n${window}`;
}

function windowLineNumbers(window: string): number[] {
  return window
    .split('\n')
    .map((line) => /^(\d+)\|/u.exec(line)?.[1])
    .filter((number): number is string => number !== undefined)
    .map(Number);
}

/** Candidates from one answer; keys stay strings from a Map, never object properties. */
function candidatesOf(
  answer: unknown,
  fields: readonly FormFillField[],
  citation: VisitNoteCitation,
): { readonly candidates: FormFillCandidate[]; readonly proposed: number } | null {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const allowed = new Set(fields.map((field) => field.id));
  const candidates: FormFillCandidate[] = [];
  let proposed = 0;
  for (const [fieldId, item] of Object.entries(answer)) {
    if (item === null || item === undefined) continue;
    proposed += 1;
    const record =
      typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    candidates.push({
      // A key outside this chunk is reported as unknown, not filed under another field.
      fieldId: allowed.has(fieldId) ? fieldId : `\u0000${fieldId}`,
      value: 'value' in record ? record['value'] : item,
      citation:
        citation === 'line'
          ? { kind: 'lines', lines: record['lines'] ?? record['line'] }
          : { kind: 'quote', quote: record['quote'] },
    });
  }
  return { candidates, proposed };
}

export async function fillFormWithModel(
  model: FormFillModel,
  form: FormFillForm,
  transcript: readonly string[],
  options: FormFillModelOptions = {},
): Promise<FormFillModelRun> {
  const citation = options.citation ?? 'line';
  const promptLines =
    citation === 'quote'
      ? transcript
      : transcript.map((line, index) =>
          line.trim()
            ? `${visitNoteLineNumber({ transcript }, 'transcript', index)}| ${line.trim()}`
            : '',
        );
  const windows = splitVisitNoteWindows(
    promptLines,
    options.windowChars ?? VISIT_NOTE_WINDOW_CHARS,
  );
  const chunks = formFillChunks(form, options.fieldsPerCall ?? FORM_FILL_FIELDS_PER_CALL);
  const total = windows.length * chunks.length;
  const candidates: FormFillCandidate[] = [];
  let calls = 0;
  let unreadableCalls = 0;
  let proposed = 0;
  for (const [windowIndex, window] of windows.entries()) {
    const lineNumbers = windowLineNumbers(window);
    for (const fields of chunks) {
      options.signal?.throwIfAborted();
      const answer = await model.complete({
        systemPrompt: formFillSystemPrompt(form, fields, citation),
        userPrompt: formFillUserPrompt(window, windowIndex + 1, windows.length),
        maxTokens: Math.min(MAX_ANSWER_TOKENS, 32 + TOKENS_PER_FIELD * fields.length),
        responseSchema: formFillResponseSchema(
          fields,
          lineNumbers.length > 0 ? lineNumbers : [1],
          citation,
        ),
      });
      options.signal?.throwIfAborted();
      calls += 1;
      const read = candidatesOf(answer, fields, citation);
      if (read) {
        candidates.push(...read.candidates);
        proposed += read.proposed;
      } else {
        unreadableCalls += 1;
      }
      options.onProgress?.(calls, total);
    }
  }
  return {
    result: buildFormFillResult(form, transcript, candidates, 'model'),
    calls,
    unreadableCalls,
    proposed,
  };
}
