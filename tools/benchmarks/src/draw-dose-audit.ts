// RX3: draws the independent audit sample of dose rules that the confidence gate lets compute, from
// instruction documents that no earlier sample touched, and prints for each rule the sentence, its
// paragraph and what the tool computes for a realistic patient of the rule's population.
//
//   DOSE_DECODED_DIR=<dir> bun tools/benchmarks/src/draw-dose-audit.ts --seed=<string> --out=<dir> \
//     --exclude-docs=<json with {picks:[{documentId}]}>... [--quotas=name=n,...]
//
// Writes <out>/draw.json and <out>/review-NN.txt (20 rules per file). It reads the index and the
// decoded modules, never changes either, and has no part in the parser or the gate.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { DoseRule } from '@localmed/contracts';
import type {
  ResolvedInstruction,
  ResolvedRule,
} from '../../../apps/app/src/features/prescription/dose-document';
import {
  GATE_ALLOWED,
  mayCompute,
  shapeOf,
} from '../../../apps/app/src/features/prescription/dose-gate';
import { formClassOf } from '../../../apps/app/src/features/prescription/dose-index';
import {
  matchPopulation,
  type PatientFacts,
} from '../../../apps/app/src/features/prescription/dose-population';
import {
  analyzeItem,
  intakeRows,
  newItem,
  registryForms,
} from '../../../apps/app/src/features/prescription/prescription-model';
import { describeRule } from './dose-rule-describe';
import {
  frameRule,
  loadIndex,
  ModuleTexts,
  populationClassOf,
  ruleKeyOf,
  seededRandom,
  shuffled,
} from './dose-rule-frame';

const args = process.argv.slice(2);
const argument = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const seed = argument('seed');
const outDirectory = argument('out');
const decoded = process.env['DOSE_DECODED_DIR'];
if (!seed || !outDirectory || !decoded) {
  throw new Error(
    'Usage: DOSE_DECODED_DIR=<dir> draw-dose-audit --seed=S --out=DIR --exclude-docs=F',
  );
}

/** Dose rules by population, caps by population, durations: 120 gate-passing rules. */
const DEFAULT_QUOTAS: Readonly<Record<string, number>> = {
  'dose|adult': 34,
  'dose|unstated': 8,
  'dose|child': 40,
  'cap|adult': 12,
  'cap|child': 12,
  duration: 14,
};
const customQuotas = argument('quotas');
const QUOTAS: Readonly<Record<string, number>> = customQuotas
  ? Object.fromEntries(
      customQuotas.split(',').map((part) => {
        const [name, count] = part.split('=');
        return [name as string, Number(count)];
      }),
    )
  : DEFAULT_QUOTAS;

function stratumOf(rule: DoseRule): string {
  const population = populationClassOf(rule);
  if (rule.k === 2) return 'duration';
  if (rule.k === 1) return population === 'child' ? 'cap|child' : 'cap|adult';
  if (population === 'child') return 'dose|child';
  if (population === 'unstated') return 'dose|unstated';
  return 'dose|adult';
}

const excludedDocuments = new Set<string>();
for (const file of args
  .filter((arg) => arg.startsWith('--exclude-docs='))
  .map((arg) => arg.slice(15))) {
  const draw = JSON.parse(readFileSync(resolve(file), 'utf8')) as {
    picks: { documentId: string }[];
  };
  for (const pick of draw.picks) excludedDocuments.add(pick.documentId);
}

const index = loadIndex();
interface Ref {
  readonly documentId: string;
  readonly rule: DoseRule;
  readonly cardSlug: string;
  readonly essential: boolean;
}
const refs: Ref[] = [];
let documentsInFrame = 0;
for (const [documentId, document] of Object.entries(index.asset.documents)) {
  if (excludedDocuments.has(documentId)) continue;
  const cards = document.c.map((cardIndex) => index.asset.cards[cardIndex]).filter((c) => c);
  const card = cards.find((candidate) => candidate?.e === 1) ?? cards[0];
  if (!card) continue;
  let any = false;
  for (const rule of document.rules) {
    if (!GATE_ALLOWED.has(shapeOf(rule))) continue;
    refs.push({ documentId, rule, cardSlug: card.s, essential: card.e === 1 });
    any = true;
  }
  if (any) documentsInFrame += 1;
}
const frameSizes: Record<string, number> = {};
for (const ref of refs) {
  const stratum = stratumOf(ref.rule);
  frameSizes[stratum] = (frameSizes[stratum] ?? 0) + 1;
}

const random = seededRandom(seed);
const moduleOf = (documentId: string): string => {
  const document = index.asset.documents[documentId];
  return document ? (index.asset.modules[document.m] ?? '') : '';
};
const moduleCounts = new Map<string, number>();
const usedDocuments = new Set<string>();
const usedCards = new Set<string>();
const pickedKeys = new Set<string>();
const picks: { key: string; stratum: string; documentId: string; cardSlug: string }[] = [];

function take(stratum: string, quota: number): void {
  const candidates = shuffled(
    refs.filter((ref) => stratumOf(ref.rule) === stratum),
    random,
  );
  for (let taken = 0; taken < quota; taken += 1) {
    let best = -1;
    let bestCount = Number.POSITIVE_INFINITY;
    for (let at = 0; at < candidates.length; at += 1) {
      const candidate = candidates[at];
      if (
        !candidate ||
        usedCards.has(candidate.cardSlug) ||
        usedDocuments.has(candidate.documentId)
      ) {
        continue;
      }
      const count = moduleCounts.get(moduleOf(candidate.documentId)) ?? 0;
      if (count < bestCount) {
        best = at;
        bestCount = count;
      }
    }
    const chosen = candidates[best];
    if (!chosen) break;
    usedCards.add(chosen.cardSlug);
    usedDocuments.add(chosen.documentId);
    pickedKeys.add(ruleKeyOf(chosen.documentId, chosen.rule));
    const module = moduleOf(chosen.documentId);
    moduleCounts.set(module, (moduleCounts.get(module) ?? 0) + 1);
    picks.push({
      key: ruleKeyOf(chosen.documentId, chosen.rule),
      stratum,
      documentId: chosen.documentId,
      cardSlug: chosen.cardSlug,
    });
  }
}
// Small strata first so that the one-rule-per-card rule never starves them.
for (const [stratum, quota] of Object.entries(QUOTAS).toSorted((a, b) => a[1] - b[1])) {
  take(stratum, quota);
}
const total = Object.values(QUOTAS).reduce((sum, value) => sum + value, 0);
// A stratum that ran dry is topped up from the dose strata, so the sample keeps its size.
for (const stratum of ['dose|child', 'dose|adult', 'cap|adult', 'duration']) {
  if (picks.length >= total) break;
  take(stratum, total - picks.length);
}
const ordered = shuffled(picks, random);

mkdirSync(outDirectory, { recursive: true });
writeFileSync(
  join(outDirectory, 'draw.json'),
  `${JSON.stringify({ seed, quotas: QUOTAS, frameSizes, documentsInFrame, excludedDocuments: excludedDocuments.size, indexBasis: index.asset.basis, picks: ordered }, null, 1)}\n`,
);

// ---------------------------------------------------------------------------------------------
// A realistic patient of the rule's population, and what the tool computes for it.
// ---------------------------------------------------------------------------------------------
const DAY = 365.25;
function realisticPatient(rule: DoseRule): PatientFacts {
  const population = populationClassOf(rule);
  const pediatric = population === 'child' || (rule.p1 !== undefined && rule.p1 <= 18 * DAY);
  if (!pediatric) {
    const weight =
      rule.w0 !== undefined && rule.w1 !== undefined
        ? (rule.w0 + rule.w1) / 20
        : rule.w0 !== undefined
          ? Math.max(70, rule.w0 / 10 + 5)
          : rule.w1 !== undefined
            ? Math.min(70, rule.w1 / 10 - 1)
            : 70;
    const age =
      rule.p0 !== undefined && rule.p0 > 18 * DAY
        ? Math.round(rule.p0 + (rule.p1 === undefined ? 5 * DAY : (rule.p1 - rule.p0) / 2))
        : Math.round(40 * DAY);
    return { ageDays: age, weightKg: weight, heightCm: 170 };
  }
  const lo = rule.p0 ?? 0;
  const hi = rule.p1 ?? 18 * DAY;
  let ageDays = Math.round(rule.p1 === undefined ? lo + 2 * DAY : (lo + hi) / 2);
  if (rule.p0 === undefined && rule.p1 === undefined) ageDays = Math.round(6 * DAY);
  ageDays = Math.min(ageDays, Math.round(17.5 * DAY));
  const years = ageDays / DAY;
  let weight: number;
  if (years < 1) weight = Math.round((ageDays / 30.4 / 2 + 4) * 10) / 10;
  else if (years < 6) weight = 2 * (years + 4);
  else if (years <= 12) weight = 3 * years + 7;
  else weight = Math.min(60, 3 * years + 7);
  weight = Math.round(weight * 10) / 10;
  if (rule.w0 !== undefined && weight * 10 < rule.w0) weight = rule.w0 / 10 + 1;
  if (rule.w1 !== undefined && weight * 10 > rule.w1) weight = rule.w1 / 10 - 1;
  weight = Math.max(2.5, weight);
  const heightCm = Math.min(175, Math.round(years < 1 ? 50 + years * 25 : 75 + 6 * years));
  return { ageDays, weightKg: weight, heightCm };
}

const texts = new ModuleTexts(decoded, index);

function resolvedRules(documentId: string): ResolvedRule[] {
  const document = index.asset.documents[documentId];
  if (!document) return [];
  return document.rules.map((rule) => {
    const section = texts.section(documentId, rule.s);
    return {
      rule,
      computable: mayCompute(rule),
      quote: section.text.slice(rule.a, rule.b).replace(/\s+/gu, ' ').trim(),
      context: null,
      sectionTitle: section.title,
      anchor: null,
    };
  });
}

/** What the tool shows for this rule and a realistic patient: the same analysis the screen runs. */
function computedLine(documentId: string, cardSlug: string, rule: DoseRule): string {
  const patient = realisticPatient(rule);
  const age =
    patient.ageDays === undefined ? '?' : `${Math.round((patient.ageDays / DAY) * 10) / 10}y`;
  const header = `patient ${age} ${patient.weightKg}kg ${patient.heightCm}cm`;
  const document = index.asset.documents[documentId];
  if (!document) return header;
  const cardIndex = index.cardBySlug.get(cardSlug);
  const card = cardIndex === undefined ? undefined : index.asset.cards[cardIndex];
  const forms = card ? registryForms(card, index.asset.forms) : [];
  const wanted = formClassOf(document.f);
  const sameForm = forms.find((entry) => formClassOf(entry.form) === wanted);
  const match = matchPopulation(rule, patient);
  const instruction: ResolvedInstruction = {
    documentId,
    tradeName: null,
    dosageForm: document.f,
    info: null,
    rules: resolvedRules(documentId),
    divisible: document.v === 1,
    origin: 'index',
    sections: [],
  };
  const strengths = sameForm?.strengths.slice(0, 4) ?? [];
  const choices: (string | null)[] =
    strengths.length > 0 ? strengths.map((entry) => entry.strength) : [null];
  const lines: string[] = [];
  for (const strength of choices) {
    const item = {
      ...newItem('audit', cardSlug, cardSlug),
      form: sameForm?.form ?? null,
      strength,
      documentId,
      ruleKey: rule.k === 0 ? `${rule.s}:${rule.a}:${rule.k}` : null,
    };
    const analysis = analyzeItem(item, { index, patient, instructionOf: () => instruction });
    const rows = intakeRows(analysis)
      .map((row) => `${row.label}: ${row.value}${row.note ? ` (${row.note})` : ''}`)
      .join(' | ');
    const mine = analysis.chosen?.key === `${rule.s}:${rule.a}:${rule.k}`;
    const caps = analysis.caps
      .map(
        (cap) =>
          `cap ${cap.check.scope} ${cap.check.limit}${cap.check.unit} vs ${cap.check.actual} ${cap.check.exceeded ? 'EXCEEDED' : 'ok'}${cap.resolved.computable ? '' : ' NOT-GATED(' + String(cap.resolved.rule.gc) + ')'} [${cap.resolved.quote.slice(0, 40)}]`,
      )
      .join('; ');
    const status = analysis.plan ? analysis.plan.status : analysis.state;
    lines.push(
      `[${strength ?? 'no strength'}] ${status}${rule.k === 0 ? (mine ? '' : ' (CHOSEN ANOTHER RULE)') : ''}: ${rows || '-'}${caps ? ` ; ${caps}` : ''}${analysis.days !== null ? ` ; days ${analysis.days}` : ''}${analysis.signa ? ` ; SIGNA: ${analysis.signa}` : ''}${analysis.quantity ? ` ; QTY: ${analysis.quantity.totalUnits} ${analysis.quantity.unitKind}` : ''}`,
    );
  }
  return `${header}; fit=${match.fit}${match.unstated ? ' (rule names no population)' : ''}; divisible=${document.v === 1}\n    ${lines.join('\n    ')}`;
}

const BATCH = 20;
for (let from = 0; from < ordered.length; from += BATCH) {
  const lines: string[] = [];
  ordered.slice(from, from + BATCH).forEach((pick, offset) => {
    const document = index.asset.documents[pick.documentId];
    const rule = document?.rules.find((item) => ruleKeyOf(pick.documentId, item) === pick.key);
    if (!document || !rule) throw new Error(`Rule ${pick.key} is not in the index`);
    const item = frameRule(index, texts, pick.documentId, rule, pick.cardSlug, pick.stratum !== '');
    const number = from + offset + 1;
    lines.push(
      `#${String(number).padStart(3, '0')}  [${pick.stratum}]  ${pick.cardSlug}  module=${item.module}  doc=${pick.documentId.slice(8, 20)}  form=${document.f ?? '-'}  section=${item.sectionTitle}`,
      `  PARSED: ${describeRule(rule)}`,
      `  RULE:   ${JSON.stringify(rule)}`,
      ...(item.headingText ? [`  HEADING-USED: ${item.headingText}`] : []),
      `  SENTENCE: ${item.sentence}`,
      `  CONTEXT: ${item.window}`,
      `  TOOL: ${computedLine(pick.documentId, pick.cardSlug, rule)}`,
      '',
    );
  });
  writeFileSync(
    join(outDirectory, `review-${String(from / BATCH + 1).padStart(2, '0')}.txt`),
    `${lines.join('\n')}\n`,
  );
}
texts.close();
console.log(
  `${ordered.length} rules drawn from ${new Set(ordered.map((pick) => pick.documentId)).size} documents; frame ${refs.length} rules in ${documentsInFrame} documents, ${JSON.stringify(frameSizes)}`,
);
