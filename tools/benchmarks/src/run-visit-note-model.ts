// SCRIBE1: a local model on the visit-note draft, through the same code the app runs
// (draftVisitNoteWithModel → the app's JSON extraction → buildVisitNoteDraft). The model is served
// by llama.cpp's llama-server with the app's context (2 048 tokens) and answer limit (512):
//
//   llama-server -m <model.gguf> -c 2048 --host 127.0.0.1 --port 8090 --jinja --reasoning-format none
//   bun src/run-visit-note-model.ts --server=http://127.0.0.1:8090 --label=<name> \
//     [--no-think] [--only=<id>] [--report=<path>]
//
// `--reasoning-format none` keeps a «<think>» block in the answer text, as the app's runtimes see it;
// without it llama-server moves an unclosed block, often the whole answer, out of `content`.
// `--no-think` prefixes «/no_think» like the app does for the qwen3 family. Each consultation of
// visit-note-consultations.json is graded on its kept field texts: `expect` patterns found, `forbid`
// patterns that must stay out, plus the quote rejections and the hands-on findings of a remote visit.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { draftVisitNoteWithModel, type VisitNoteModel } from '@localmed/core';

import {
  extractStructuredJson,
  extractTruncatedJson,
} from '../../../apps/app/src/features/models/structured-output';

const args = process.argv.slice(2);
const option = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const server = option('server') ?? 'http://127.0.0.1:8090';
const label = option('label') ?? 'model';
const only = option('only');
const reportPath = option('report');
const noThink = args.includes('--no-think');

interface Pattern {
  readonly field: string;
  readonly pattern: string;
}
interface Consultation {
  readonly id: string;
  readonly remote: boolean;
  readonly transcript: readonly string[];
  readonly priorRecord?: readonly string[];
  readonly expect: readonly Pattern[];
  readonly forbid: readonly Pattern[];
}

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../visit-note-consultations.json'), 'utf8'),
) as { readonly consultations: readonly Consultation[] };

interface Answer {
  readonly userPrompt: string;
  readonly rawText: string;
  readonly seconds: number;
}

function serverModel(answers: Answer[]): VisitNoteModel {
  return {
    async complete(request) {
      const startedAt = performance.now();
      const response = await fetch(`${server}/v1/chat/completions`, {
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
        }),
      });
      if (!response.ok) throw new Error(`llama-server answered ${response.status}`);
      const body = (await response.json()) as {
        readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
      };
      const rawText = body.choices?.[0]?.message?.content?.trim() ?? '';
      answers.push({
        userPrompt: request.userPrompt.split('\n', 1)[0] ?? '',
        rawText,
        seconds: (performance.now() - startedAt) / 1000,
      });
      return extractStructuredJson(rawText) ?? extractTruncatedJson(rawText);
    },
  };
}

const results = [];
let expectedFound = 0;
let expectedTotal = 0;
let forbiddenHits = 0;
for (const consultation of fixture.consultations) {
  if (only && consultation.id !== only) continue;
  const answers: Answer[] = [];
  const startedAt = performance.now();
  const result = await draftVisitNoteWithModel(serverModel(answers), {
    transcript: consultation.transcript,
    ...(consultation.priorRecord ? { priorRecord: consultation.priorRecord } : {}),
    remote: consultation.remote,
  });
  const seconds = (performance.now() - startedAt) / 1000;
  const text = new Map(result.draft.fields.map((field) => [field.field, field.text]));
  const matches = (pattern: Pattern) =>
    new RegExp(pattern.pattern, 'iu').test(text.get(pattern.field as never) ?? '');
  const missed = consultation.expect.filter((pattern) => !matches(pattern));
  const forbidden = consultation.forbid.filter(matches);
  expectedFound += consultation.expect.length - missed.length;
  expectedTotal += consultation.expect.length;
  forbiddenHits += forbidden.length;
  const rejections: Record<string, number> = {};
  for (const rejection of result.draft.rejected) {
    rejections[rejection.code] = (rejections[rejection.code] ?? 0) + 1;
  }
  const kept = result.draft.fields.reduce((sum, field) => sum + field.quotes.length, 0);
  console.log(
    `${consultation.id}: expected ${consultation.expect.length - missed.length}/${consultation.expect.length}, ` +
      `forbidden ${forbidden.length}, kept ${kept}, rejected ${JSON.stringify(rejections)}, ` +
      `windows ${result.windows} (unreadable ${result.unreadableWindows}), ` +
      `remote findings ${result.draft.remoteExamFindings.length}, ${seconds.toFixed(1)} s`,
  );
  for (const pattern of missed) console.log(`  missed ${pattern.field} /${pattern.pattern}/`);
  for (const pattern of forbidden) console.log(`  forbidden ${pattern.field} /${pattern.pattern}/`);
  results.push({
    id: consultation.id,
    seconds,
    missed,
    forbidden,
    rejections,
    draft: result.draft,
    answers,
  });
}
console.log(
  `${label}: expected facts ${expectedFound}/${expectedTotal}, forbidden ${forbiddenHits}`,
);
if (reportPath) {
  writeFileSync(
    reportPath,
    `${JSON.stringify({ label, server, noThink, expectedFound, expectedTotal, forbiddenHits, results }, null, 2)}\n`,
  );
}
