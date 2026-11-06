// FORMFILL1: the form fillers on real conversation transcripts that stay on this machine. Reads the
// transcripts by path (one recognised segment per line, as the recorder stores them), runs
//   - PSY1's psychiatric-status cue matcher,
//   - the generic word-cue filler on PHQ-9,
//   - with `--server=` a local model under the JSON schema (llama-server, as run-form-fill.ts) on
//     PHQ-9 and on the psychiatric-status catalog as a form (one yes/no field per phrase,
//     sections as the form's sections),
// prints every proposal with its quote for review, and writes the full result to `--report=`.
// Transcripts, quotes and reports are patient words: keep them under `output/` (gitignored), never in
// git; only aggregate numbers go into docs.
//
//   bun src/run-form-fill-local.ts --transcript=<path>[,<path>] [--server=http://127.0.0.1:8090] \
//     [--report=<path under output/>]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  FORM_FILL_SCHEMA_VERSION,
  type FormFillForm,
  type FormFillResult,
  parseFormFillForm,
} from '@localmed/contracts';
import {
  type FormFillModel,
  fillFormWithCues,
  fillFormWithModel,
  formFillFromAssessment,
  formFillOverlayFor,
} from '@localmed/core/form-fill';
import {
  fillPsyStatusFromTranscript,
  PSY_STATUS_CATALOG,
  psyStatusPhrase,
} from '@localmed/core/psy-status';

import {
  extractStructuredJson,
  extractTruncatedJson,
} from '../../../apps/app/src/features/models/structured-output';

const args = process.argv.slice(2);
const option = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const transcripts = (option('transcript') ?? '').split(',').filter(Boolean);
const server = option('server');
const reportPath = option('report');
if (transcripts.length === 0) throw new Error('--transcript=<path> is required');

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

const phq9 = formFillFromAssessment(
  tool('psychology', 'minimed.assessment.phq-9') as never,
  formFillOverlayFor('minimed.assessment.phq-9'),
).form;

/** The psychiatric-status catalog as a form: a yes/no field per phrase, «да» when the conversation shows it. */
const psyStatusForm: FormFillForm = parseFormFillForm({
  schemaVersion: FORM_FILL_SCHEMA_VERSION,
  id: 'psy-status',
  title: 'Психический статус',
  sections: PSY_STATUS_CATALOG.modules.flatMap((module) =>
    module.sections.map((section) => ({
      id: `${module.id}-${section.id}`,
      title: `${module.name}: ${section.name}`,
      fieldIds: section.phrases.map((phrase) => phrase.code),
    })),
  ),
  fields: PSY_STATUS_CATALOG.modules.flatMap((module) =>
    module.sections.flatMap((section) =>
      section.phrases.map((phrase) => ({
        id: phrase.code,
        label: phrase.text,
        type: 'boolean',
        hint: section.name,
      })),
    ),
  ),
});

/** Raw answers of the model per run, for review of what it proposed before any check. */
let rawAnswers: { readonly fields: string; readonly text: string }[] = [];

function serverModel(url: string): FormFillModel {
  return {
    async complete(request) {
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          max_tokens: request.maxTokens,
          temperature: 0,
          top_p: 1,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'form_fill', schema: request.responseSchema },
          },
        }),
      });
      if (!response.ok) throw new Error(`llama-server answered ${response.status}`);
      const body = (await response.json()) as {
        readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
      };
      const text = body.choices?.[0]?.message?.content ?? '';
      rawAnswers.push({ fields: (request.responseSchema['required'] as string[]).join(','), text });
      return extractStructuredJson(text) ?? extractTruncatedJson(text);
    },
  };
}

function printResult(title: string, form: FormFillForm, result: FormFillResult): void {
  const labels = new Map(form.fields.map((field) => [field.id, field.label]));
  console.log(`  ${title}:`);
  for (const [fieldId, proposal] of Object.entries(result.fields)) {
    if (!proposal) continue;
    const quotes = proposal.evidence.map(
      (item) => `«${item.quote.text}» (стр. ${item.quote.startLine + 1})`,
    );
    console.log(
      `    ${fieldId} = ${JSON.stringify(proposal.value)} — ${labels.get(fieldId)}\n      ${quotes.join('\n      ')}`,
    );
  }
  const rejected: Record<string, number> = {};
  for (const rejection of result.rejected)
    rejected[rejection.code] = (rejected[rejection.code] ?? 0) + 1;
  console.log(`    rejected ${JSON.stringify(rejected)}`);
}

const report = [];
for (const path of transcripts) {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim());
  console.log(`\n=== ${path} (${lines.length} lines)`);

  const psy = fillPsyStatusFromTranscript(lines);
  console.log('  PSY1 cues:');
  for (const suggestion of psy) {
    const phrase = psyStatusPhrase(suggestion.code)?.phrase.text;
    console.log(`    ${suggestion.code} (${suggestion.kind}) — ${phrase}`);
    for (const quote of suggestion.quotes)
      console.log(`      «${quote.text}» (стр. ${quote.startLine + 1})`);
  }

  const phqCues = fillFormWithCues(phq9, lines);
  printResult('PHQ-9 cues', phq9, phqCues);

  const entry: Record<string, unknown> = { path, psy, phqCues };
  if (server) {
    const model = serverModel(server);
    rawAnswers = [];
    let started = performance.now();
    const phqModel = await fillFormWithModel(model, phq9, lines);
    console.log(
      `  PHQ-9 model: ${phqModel.calls} calls, ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
    printResult('PHQ-9 model', phq9, phqModel.result);
    entry['phqRaw'] = rawAnswers;
    rawAnswers = [];
    started = performance.now();
    const psyModel = await fillFormWithModel(model, psyStatusForm, lines);
    console.log(
      `  psy-status model: ${psyModel.calls} calls, ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
    printResult('psy-status model', psyStatusForm, psyModel.result);
    entry['phqModel'] = phqModel;
    entry['psyModel'] = psyModel;
    entry['psyRaw'] = rawAnswers;
  }
  report.push(entry);
}
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
