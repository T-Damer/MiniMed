// RX5: turns the second audit draw (draw-dose-audit-2.ts) and the auditor's judgement lines into the
// committed set tools/benchmarks/dose-rule-audit-2-2026-10-14.json, in the format of run-dose-precision.ts.
//
//   DOSE_DECODED_DIR=<dir> bun tools/benchmarks/src/build-dose-audit-2-set.ts \
//     --draw=<draw.json> --reviews=<dir with review-NN.txt> --judgements=<judgements.txt> --out=<file>
//
// A judgement line is `NNN [tokens] | reason`; a rule may have several lines (tokens are merged, the
// reasons joined). Tokens are separated by commas: `field=w|i` (a field of the rule, as in
// build-dose-precision-set.ts), `ind` (the sentence is one indication or regimen of several; not
// counted as wrong, as in the RX2 protocol) and `out=<kind>` (what the screen prints for the rule is
// wrong; the rule itself may be right). Output kinds: `dose`, `strength`, `cap`, `daily` change a
// number or a comparison on screen; `route` and `form` change the words of the sign (route, product).
// The rule is taken from the RULE: line of the review file, as the auditor saw it. The set holds no
// instruction text, only the rule, a checksum of its sentence and the reason.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { DoseRule } from '@localmed/contracts';

import {
  carries,
  DOSE_RELEVANT,
  FIELDS,
  type Field,
  type FieldStatus,
} from './build-dose-precision-set';
import { frameRule, loadIndex, ModuleTexts } from './dose-rule-frame';

const args = process.argv.slice(2);
const argument = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const drawFile = argument('draw');
const reviews = argument('reviews');
const judgementsFile = argument('judgements');
const out = argument('out');
const decoded = process.env['DOSE_DECODED_DIR'];
if (!drawFile || !reviews || !judgementsFile || !out || !decoded) {
  throw new Error('Usage: see the header of build-dose-audit-2-set.ts');
}

/** Output defects that change a number or a comparison on the screen (the others change words). */
const NUMERIC_OUTPUT = new Set(['dose', 'strength', 'cap', 'daily']);
const OUTPUT_KINDS = new Set([...NUMERIC_OUTPUT, 'route', 'form']);

interface Draw {
  readonly seed: string;
  readonly quotas: Record<string, number>;
  readonly frameSizes: Record<string, number>;
  readonly frameModules: Record<string, number>;
  readonly documentsInFrame: number;
  readonly excludedDocuments: number;
  readonly documentsOfEarlierSets: number;
  readonly documentsOfBenchmarkCards: number;
  readonly indexBasis: unknown;
  readonly picks: { key: string; stratum: string; documentId: string; cardSlug: string }[];
}
const draw = JSON.parse(readFileSync(resolve(drawFile), 'utf8')) as Draw;

interface Judgement {
  fields: Map<Field, 'w' | 'i'>;
  ind: boolean;
  out: Set<string>;
  reasons: string[];
}
const judgements = new Map<number, Judgement>();
for (const line of readFileSync(resolve(judgementsFile), 'utf8').split('\n')) {
  if (line.trim() === '') continue;
  const match = /^(\d{3})\s*([^|]*)\|\s*(.*)$/u.exec(line);
  if (!match) throw new Error(`Unreadable judgement line: ${line}`);
  const number = Number(match[1]);
  const entry = judgements.get(number) ?? {
    fields: new Map<Field, 'w' | 'i'>(),
    ind: false,
    out: new Set<string>(),
    reasons: [],
  };
  for (const part of (match[2] ?? '').split(',').map((item) => item.trim())) {
    if (part === '') continue;
    if (part === 'ind') {
      entry.ind = true;
      continue;
    }
    const output = /^out=([a-z]+)$/u.exec(part);
    if (output) {
      if (!OUTPUT_KINDS.has(output[1] as string)) throw new Error(`Unknown output kind: ${line}`);
      entry.out.add(output[1] as string);
      continue;
    }
    const pair = /^([a-z]+)=([wi])$/u.exec(part);
    if (!pair || !(FIELDS as readonly string[]).includes(pair[1] ?? '')) {
      throw new Error(`Unreadable token "${part}" in: ${line}`);
    }
    entry.fields.set(pair[1] as Field, pair[2] as 'w' | 'i');
  }
  const reason = (match[3] ?? '').trim();
  if (reason !== '' && reason !== 'correct') entry.reasons.push(reason);
  judgements.set(number, entry);
}

const judgedRules = new Map<number, DoseRule>();
for (let file = 1; file <= Math.ceil(draw.picks.length / 20); file += 1) {
  let number = 0;
  const name = `review-${String(file).padStart(2, '0')}.txt`;
  for (const line of readFileSync(join(resolve(reviews), name), 'utf8').split('\n')) {
    const header = /^#(\d{3})\s/u.exec(line);
    if (header) number = Number(header[1]);
    const rule = /^\s+RULE:\s+(\{.*\})\s*$/u.exec(line);
    if (rule && number > 0) judgedRules.set(number, JSON.parse(rule[1] as string) as DoseRule);
  }
}

const index = loadIndex();
const texts = new ModuleTexts(decoded, index);
const items = draw.picks.map((pick, position) => {
  const judgement = judgements.get(position + 1);
  if (!judgement) throw new Error(`Rule #${position + 1} (${pick.key}) has no judgement`);
  const document = index.asset.documents[pick.documentId];
  const rule = document?.rules.find(
    (item) => `${pick.documentId}#${item.s}:${item.a}:${item.k}` === pick.key,
  );
  if (!document || !rule) throw new Error(`Rule ${pick.key} is not in the index`);
  const judged = judgedRules.get(position + 1) ?? rule;
  const framed = frameRule(index, texts, pick.documentId, rule, pick.cardSlug, true);
  const fields = {} as Record<Field, FieldStatus>;
  for (const field of FIELDS) {
    const mark = judgement.fields.get(field);
    fields[field] =
      mark === 'w'
        ? 'wrong'
        : mark === 'i'
          ? 'incomplete'
          : carries(judged, field)
            ? 'ok'
            : 'absent';
  }
  const wrongFields = FIELDS.filter((field) => fields[field] === 'wrong');
  const incompleteFields = FIELDS.filter((field) => fields[field] === 'incomplete');
  const outputDefects = [...judgement.out].toSorted();
  return {
    id: pick.key,
    number: position + 1,
    documentId: pick.documentId,
    card: pick.cardSlug,
    module: framed.module,
    stratum: pick.stratum,
    sentenceSha256: framed.sentenceSha256,
    rule: judged,
    fields,
    verdict:
      wrongFields.length > 0 ? 'wrong' : incompleteFields.length > 0 ? 'incomplete' : 'correct',
    doseRelevantWrong: wrongFields.some((field) => DOSE_RELEVANT.has(field)),
    indicationBound: judgement.ind,
    indicationMarked: rule.i !== undefined || rule.sv === 1,
    outputDefects,
    screenWrong: outputDefects.length > 0,
    screenNumericWrong: outputDefects.some((kind) => NUMERIC_OUTPUT.has(kind)),
    reason: judgement.reasons.join(' ‖ '),
  };
});
texts.close();
const result = {
  name: 'RX5 independent audit 2 of computed dose rules',
  note: 'Independent audit 2 (2026-10-14, after the RX4 fixes): random rules the confidence gate lets compute, drawn from instruction documents that no earlier sample, audit or benchmark card touched; judged field by field against the sentence and paragraph, and the screen output (analyzeItem, every registry strength of the instruction form class) judged for a realistic patient of the rule population. `indicationBound` (the sentence is one indication or regimen of several; `indicationMarked`: the rule carries it) is not counted as wrong, as in the RX2 protocol. `verdict` and `doseRelevantWrong` judge the rule; `outputDefects` / `screenWrong` judge what the screen prints (numeric kinds: dose, strength, cap, daily; wording kinds: route, form).',
  draws: [
    {
      seed: draw.seed,
      drawnFrom: {
        frameSizes: draw.frameSizes,
        frameModules: draw.frameModules,
        quotas: draw.quotas,
        documentsInFrame: draw.documentsInFrame,
        excludedDocuments: draw.excludedDocuments,
        documentsOfEarlierSets: draw.documentsOfEarlierSets,
        documentsOfBenchmarkCards: draw.documentsOfBenchmarkCards,
        indexBasis: draw.indexBasis,
      },
    },
  ],
  items,
};
writeFileSync(resolve(out), `${JSON.stringify(result, null, 1)}\n`);
const count = (verdict: string): number => items.filter((item) => item.verdict === verdict).length;
console.log(
  `${items.length} items: correct ${count('correct')}, incomplete ${count('incomplete')}, wrong ${count('wrong')} (dose-relevant wrong ${items.filter((item) => item.doseRelevantWrong).length}); screen wrong ${items.filter((item) => item.screenWrong).length} (numeric ${items.filter((item) => item.screenNumericWrong).length}); rule or screen wrong ${items.filter((item) => item.verdict === 'wrong' || item.screenWrong).length}; indication-bound ${items.filter((item) => item.indicationBound).length} (unmarked ${items.filter((item) => item.indicationBound && !item.indicationMarked).length})`,
);
