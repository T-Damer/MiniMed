// FORMFILL1: a form filled from a conversation, measured on synthetic Russian consultations
// (form-fill-transcripts.json) against three real forms of the app: CHA₂DS₂-VASc, PHQ-9 and 070/у.
//
// Without a server it runs the deterministic word-cue fallback (what the app does with no model):
//
//   bun src/run-form-fill.ts [--report=<path>]
//
// With a model served by llama.cpp's llama-server (app context 2 048 tokens, answers under the
// JSON schema the core builds, sent as `response_format`, which llama-server turns into a grammar):
//
//   llama-server -m <model.gguf> -c 2048 --host 127.0.0.1 --port 8090 --jinja --reasoning-format none
//   bun src/run-form-fill.ts --server=http://127.0.0.1:8090 --label=<name> [--no-think] \
//     [--no-schema] [--citation=line|quote] [--fields=<per call>] [--only=<id>] [--report=<path>]
//
// Per field: a proposed value is right when it equals the expected one (text: matches its pattern).
// Precision = right / proposed, recall = right / expected. «No quote» = model values dropped because
// their citation failed the quote check (or the quote did not carry the value), over all non-null
// values the model proposed; the cue fallback quotes spans of the transcript, so it has none.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CalculatorSchemaSchema,
  type FormFillResult,
  type FormFillValue,
  parseFormSchema,
} from '@localmed/contracts';
import type { VisitNoteCitation } from '@localmed/core';
import {
  type FormFillBinding,
  type FormFillModel,
  fillFormWithCues,
  fillFormWithModel,
  formFillFromAssessment,
  formFillFromCalculator,
  formFillFromOfficialForm,
  formFillOverlayFor,
} from '@localmed/core/form-fill';

import {
  extractStructuredJson,
  extractTruncatedJson,
} from '../../../apps/app/src/features/models/structured-output';

const args = process.argv.slice(2);
const option = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const server = option('server');
const label = option('label') ?? (server ? 'model' : 'cues');
const only = option('only');
const reportPath = option('report');
const noThink = args.includes('--no-think');
const noSchema = args.includes('--no-schema');
const citation: VisitNoteCitation = option('citation') === 'quote' ? 'quote' : 'line';
const fieldsPerCall = option('fields') ? Number(option('fields')) : undefined;

const ROOT = resolve(import.meta.dirname, '../../..');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as unknown;

function tool(module: string, id: string): unknown {
  const pack = readJson(`content/tool-modules/${module}.json`) as {
    readonly tools: readonly { readonly id: string; readonly definition: unknown }[];
  };
  const found = pack.tools.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no tool ${id}`);
  return found.definition;
}

const FORMS: ReadonlyMap<string, FormFillBinding> = new Map([
  [
    'minimed.calculator.cha2ds2-vasc',
    formFillFromCalculator(
      CalculatorSchemaSchema.parse(tool('core-clinical', 'minimed.calculator.cha2ds2-vasc')),
      formFillOverlayFor('minimed.calculator.cha2ds2-vasc'),
    ),
  ],
  [
    'minimed.assessment.phq-9',
    formFillFromAssessment(
      tool('psychology', 'minimed.assessment.phq-9') as never,
      formFillOverlayFor('minimed.assessment.phq-9'),
    ),
  ],
  [
    'ru.minzdrav.274n.070u',
    formFillFromOfficialForm(
      parseFormSchema(readJson('apps/app/src/features/forms/schemas/ru-minzdrav-274n-070u.json')),
      formFillOverlayFor('ru.minzdrav.274n.070u'),
    ),
  ],
]);

type Expected = FormFillValue | { readonly pattern: string };
interface Fixture {
  readonly id: string;
  readonly form: string;
  readonly transcript: readonly string[];
  readonly expected: Readonly<Record<string, Expected>>;
}

const fixture = readJson('tools/benchmarks/form-fill-transcripts.json') as {
  readonly transcripts: readonly Fixture[];
};

interface Answer {
  readonly prompt: string;
  readonly rawText: string;
  readonly seconds: number;
}

function serverModel(url: string, answers: Answer[]): FormFillModel {
  return {
    async complete(request) {
      const startedAt = performance.now();
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: `${noThink ? '/no_think\n' : ''}${request.userPrompt}` },
          ],
          max_tokens: request.maxTokens,
          temperature: 0,
          top_p: 1,
          ...(noSchema
            ? {}
            : {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'form_fill', schema: request.responseSchema },
                },
              }),
        }),
      });
      if (!response.ok) {
        throw new Error(`llama-server answered ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as {
        readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
      };
      const rawText = body.choices?.[0]?.message?.content?.trim() ?? '';
      answers.push({
        prompt: (request.responseSchema['required'] as string[]).join(','),
        rawText,
        seconds: (performance.now() - startedAt) / 1000,
      });
      return extractStructuredJson(rawText) ?? extractTruncatedJson(rawText);
    },
  };
}

function matches(expected: Expected, value: FormFillValue): boolean {
  if (typeof expected === 'object' && !Array.isArray(expected)) {
    return typeof value === 'string' && new RegExp(expected.pattern, 'iu').test(value);
  }
  if (Array.isArray(expected) && Array.isArray(value)) {
    return expected.length === value.length && expected.every((item) => value.includes(item));
  }
  return expected === value;
}

const QUOTE_CODES = new Set([
  'missing-citation',
  'quote-too-short',
  'quote-not-found',
  'quote-negated',
  'line-not-found',
  'line-unrelated',
  'value-not-in-quote',
]);

let right = 0;
let proposed = 0;
let expectedTotal = 0;
let modelProposed = 0;
let noQuote = 0;
let seconds = 0;
const results = [];
for (const item of fixture.transcripts) {
  if (only && item.id !== only) continue;
  const binding = FORMS.get(item.form);
  if (!binding) throw new Error(`no form ${item.form}`);
  const answers: Answer[] = [];
  const startedAt = performance.now();
  let result: FormFillResult;
  let calls = 0;
  let itemProposed = 0;
  if (server) {
    const run = await fillFormWithModel(
      serverModel(server, answers),
      binding.form,
      item.transcript,
      {
        citation,
        ...(fieldsPerCall ? { fieldsPerCall } : {}),
      },
    );
    result = run.result;
    calls = run.calls;
    itemProposed = run.proposed;
  } else {
    result = fillFormWithCues(binding.form, item.transcript);
  }
  const itemSeconds = (performance.now() - startedAt) / 1000;
  seconds += itemSeconds;
  const wrong: string[] = [];
  const missed: string[] = [];
  let itemRight = 0;
  let itemValues = 0;
  for (const field of binding.form.fields) {
    const value = result.fields[field.id]?.value;
    const expected = item.expected[field.id];
    if (value !== undefined) itemValues += 1;
    if (value !== undefined && expected !== undefined && matches(expected, value)) itemRight += 1;
    else if (value !== undefined) wrong.push(`${field.id}=${JSON.stringify(value)}`);
    if (expected !== undefined && (value === undefined || !matches(expected, value))) {
      missed.push(field.id);
    }
  }
  const itemExpected = Object.keys(item.expected).length;
  const itemNoQuote = result.rejected.filter((rejection) => QUOTE_CODES.has(rejection.code)).length;
  right += itemRight;
  proposed += itemValues;
  expectedTotal += itemExpected;
  modelProposed += itemProposed;
  noQuote += server ? itemNoQuote : 0;
  const rejections: Record<string, number> = {};
  for (const rejection of result.rejected) {
    rejections[rejection.code] = (rejections[rejection.code] ?? 0) + 1;
  }
  console.log(
    `${item.id}: right ${itemRight}, proposed ${itemValues}, expected ${itemExpected}` +
      (server ? `, model values ${itemProposed}, calls ${calls}` : '') +
      `, rejected ${JSON.stringify(rejections)}, ${itemSeconds.toFixed(1)} s`,
  );
  if (wrong.length > 0) console.log(`  wrong: ${wrong.join(' ')}`);
  if (missed.length > 0) console.log(`  missed: ${missed.join(' ')}`);
  results.push({ id: item.id, form: item.form, result, wrong, missed, answers });
}

const ratio = (a: number, b: number) => (b === 0 ? 'n/a' : (a / b).toFixed(2));
console.log(
  `${label}: precision ${ratio(right, proposed)} (${right}/${proposed}), recall ${ratio(right, expectedTotal)} (${right}/${expectedTotal})` +
    (server
      ? `, no quote ${ratio(noQuote, modelProposed)} (${noQuote}/${modelProposed} model values)`
      : '') +
    `, ${seconds.toFixed(1)} s`,
);
if (reportPath) {
  writeFileSync(
    reportPath,
    `${JSON.stringify({ label, server, noThink, noSchema, citation, right, proposed, expectedTotal, modelProposed, noQuote, results }, null, 2)}\n`,
  );
}
