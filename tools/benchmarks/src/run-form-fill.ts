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
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
  type FormFillModelRequest,
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
const wllamaModel = option('wllama');
const webview = option('webview');
const deviceModel = option('device-model');
const usesModel = Boolean(server || wllamaModel || webview);
const label = option('label') ?? (usesModel ? 'model' : 'cues');
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

/** One completion as raw text; the runtime differs, the request and the parsing do not. */
type Complete = (request: FormFillModelRequest) => Promise<string>;

function recordingModel(complete: Complete, answers: Answer[]): FormFillModel {
  return {
    async complete(request) {
      const startedAt = performance.now();
      const rawText = (await complete(request)).trim();
      answers.push({
        prompt: (request.responseSchema['required'] as string[]).join(','),
        rawText,
        seconds: (performance.now() - startedAt) / 1000,
      });
      return extractStructuredJson(rawText) ?? extractTruncatedJson(rawText);
    },
  };
}

const messages = (request: FormFillModelRequest) => [
  { role: 'system', content: request.systemPrompt },
  { role: 'user', content: `${noThink ? '/no_think\n' : ''}${request.userPrompt}` },
];

const responseFormat = (request: FormFillModelRequest) =>
  noSchema
    ? {}
    : {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'form_fill', schema: request.responseSchema },
        },
      };

/** llama.cpp's llama-server, as in SCRIBE1's qualification. */
function serverCompletion(url: string): Complete {
  return async (request) => {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: messages(request),
        max_tokens: request.maxTokens,
        temperature: 0,
        top_p: 1,
        ...responseFormat(request),
      }),
    });
    if (!response.ok) {
      throw new Error(`llama-server answered ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as {
      readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
    };
    return body.choices?.[0]?.message?.content ?? '';
  };
}

/**
 * The browser runtime the app ships (wllama 3.5.1 from the catalog's CDN URLs) in headless Chromium,
 * the GGUF served from this machine; the request goes the way `BrowserWllamaSession` sends it.
 */
async function wllamaCompletion(
  modelPath: string,
): Promise<{ complete: Complete; close: () => Promise<void> }> {
  const catalog = readJson('apps/app/src/features/models/catalog.preview.json') as {
    readonly runtime: { readonly wllamaModuleUrl: string; readonly wllamaWasmUrl: string };
  };
  const files = createServer((request, response) => {
    if (request.url === '/model.gguf') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': statSync(modelPath).size,
        'cross-origin-resource-policy': 'same-origin',
      });
      createReadStream(modelPath).pipe(response);
      return;
    }
    // Cross-origin isolated like the app's own servers (vite.config.ts), so wllama runs threads;
    // `credentialless` lets the page load wllama from the catalog's CDN.
    response.writeHead(200, {
      'content-type': 'text/html',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'credentialless',
    });
    response.end('<!doctype html><title>wllama</title>');
  });
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
  const port = (files.address() as AddressInfo).port;
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const loadSeconds = await page.evaluate(
    async ({ moduleUrl, wasmUrl }) => {
      const startedAt = performance.now();
      const module = (await import(moduleUrl)) as {
        Wllama: new (
          paths: Record<string, string>,
          config: object,
        ) => {
          loadModel(blobs: Blob[], options: object): Promise<void>;
        };
      };
      const wllama = new module.Wllama({ default: wasmUrl }, { suppressNativeLog: true });
      const blob = await (await fetch('/model.gguf')).blob();
      await wllama.loadModel([blob], {
        n_ctx: 2048,
        n_threads: Math.max(1, Math.min(6, navigator.hardwareConcurrency - 1)),
        n_gpu_layers: 0,
      });
      (window as unknown as { wllama: unknown }).wllama = wllama;
      return { seconds: (performance.now() - startedAt) / 1000, isolated: crossOriginIsolated };
    },
    { moduleUrl: catalog.runtime.wllamaModuleUrl, wasmUrl: catalog.runtime.wllamaWasmUrl },
  );
  console.log(
    `wllama: model loaded in ${loadSeconds.seconds.toFixed(1)} s, cross-origin isolated: ${loadSeconds.isolated}`,
  );
  return {
    complete: (request) =>
      page.evaluate(
        async (body) => {
          const wllama = (
            window as unknown as {
              wllama: {
                createChatCompletion(
                  options: object,
                ): Promise<{ choices?: { message?: { content?: string } }[] }>;
              };
            }
          ).wllama;
          const result = await wllama.createChatCompletion(body);
          return result.choices?.[0]?.message?.content ?? '';
        },
        {
          messages: messages(request),
          max_tokens: request.maxTokens,
          temperature: 0,
          top_p: 1,
          ...responseFormat(request),
        },
      ),
    close: async () => {
      await browser.close();
      await new Promise<void>((resolve) => files.close(() => resolve()));
    },
  };
}

/**
 * The Android app's native runtime on a device or emulator: the WebView's DevTools socket
 * (`adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>`, then its page's
 * `webSocketDebuggerUrl`) and the `LlamaInference` plugin the app calls, schema as `responseSchema`.
 */
async function webviewCompletion(
  socketUrl: string,
): Promise<{ complete: Complete; close: () => Promise<void> }> {
  const socket = new WebSocket(socketUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('DevTools socket did not open')), {
      once: true,
    });
  });
  let nextId = 1;
  const pending = new Map<number, (value: unknown) => void>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: unknown;
    };
    if (message.id !== undefined) pending.get(message.id)?.(message);
  });
  const evaluate = (expression: string): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (raw) => {
        pending.delete(id);
        const message = raw as {
          result?: {
            result?: { value?: unknown };
            exceptionDetails?: { exception?: { description?: string } };
          };
          error?: { message?: string };
        };
        const failure =
          message.error?.message ?? message.result?.exceptionDetails?.exception?.description;
        if (failure) reject(new Error(failure));
        else resolve(message.result?.result?.value);
      });
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  const plugin = 'window.Capacitor.Plugins.LlamaInference';
  if (deviceModel) {
    const startedAt = performance.now();
    await evaluate(`${plugin}.initializeModel(${JSON.stringify({ path: deviceModel })})`);
    console.log(`device: model loaded in ${((performance.now() - startedAt) / 1000).toFixed(1)} s`);
  }
  return {
    complete: async (request) => {
      const options = {
        systemPrompt: request.systemPrompt,
        userPrompt: `${noThink ? '/no_think\n' : ''}${request.userPrompt}`,
        maxTokens: request.maxTokens,
        ...(noSchema ? {} : { responseSchema: JSON.stringify(request.responseSchema) }),
      };
      const value = await evaluate(
        `${plugin}.complete(${JSON.stringify(options)}).then((r) => r.text)`,
      );
      return typeof value === 'string' ? value : '';
    },
    close: async () => socket.close(),
  };
}

const runtime: { complete: Complete; close: () => Promise<void> } | undefined = server
  ? { complete: serverCompletion(server), close: async () => undefined }
  : wllamaModel
    ? await wllamaCompletion(wllamaModel)
    : webview
      ? await webviewCompletion(webview)
      : undefined;

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
  if (runtime) {
    const run = await fillFormWithModel(
      recordingModel(runtime.complete, answers),
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
  noQuote += usesModel ? itemNoQuote : 0;
  const rejections: Record<string, number> = {};
  for (const rejection of result.rejected) {
    rejections[rejection.code] = (rejections[rejection.code] ?? 0) + 1;
  }
  console.log(
    `${item.id}: right ${itemRight}, proposed ${itemValues}, expected ${itemExpected}` +
      (usesModel ? `, model values ${itemProposed}, calls ${calls}` : '') +
      `, rejected ${JSON.stringify(rejections)}, ${itemSeconds.toFixed(1)} s`,
  );
  if (wrong.length > 0) console.log(`  wrong: ${wrong.join(' ')}`);
  if (missed.length > 0) console.log(`  missed: ${missed.join(' ')}`);
  results.push({ id: item.id, form: item.form, result, wrong, missed, answers });
}

const ratio = (a: number, b: number) => (b === 0 ? 'n/a' : (a / b).toFixed(2));
console.log(
  `${label}: precision ${ratio(right, proposed)} (${right}/${proposed}), recall ${ratio(right, expectedTotal)} (${right}/${expectedTotal})` +
    (usesModel
      ? `, no quote ${ratio(noQuote, modelProposed)} (${noQuote}/${modelProposed} model values)`
      : '') +
    `, ${seconds.toFixed(1)} s`,
);
await runtime?.close();
const seconds_per_call = results.flatMap((r) => r.answers.map((a) => a.seconds));
if (seconds_per_call.length > 0) {
  const sorted = seconds_per_call.toSorted((a, b) => a - b);
  console.log(
    `per call: median ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2)} s, max ${(sorted.at(-1) ?? 0).toFixed(2)} s over ${sorted.length} calls`,
  );
}
if (reportPath) {
  writeFileSync(
    reportPath,
    `${JSON.stringify({ label, server, noThink, noSchema, citation, right, proposed, expectedTotal, modelProposed, noQuote, results }, null, 2)}\n`,
  );
}
