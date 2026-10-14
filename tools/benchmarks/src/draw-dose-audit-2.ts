// RX5: draws the second independent audit sample of dose rules that the confidence gate lets compute
// (after the RX4 fixes), from instruction documents that no earlier sample, audit or benchmark card
// touched, and prints for each rule the sentence, its paragraph and everything the screen's own
// analysis (`analyzeItem`) computes for a realistic patient of the rule's population on each registry
// strength (single dose, intakes, units per intake, rounding, signa, quantity, cap comparison).
//
//   DOSE_DECODED_DIR=<dir> bun tools/benchmarks/src/draw-dose-audit-2.ts --seed=<string> --out=<dir> \
//     --exclude-docs=<json with documentId fields>... --exclude-cards-of=<dose-queries.json> \
//     [--quotas=name=n,...] [--dry]
//
// Strata: kind (dose / cap / duration) x population (adult / child / unstated) x indication-bound
// ('i' or 'sv' on the rule) or general; one rule per document and per card; documents are picked
// from the least-used instruction module (the pharmacological group) first.
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
    'Usage: DOSE_DECODED_DIR=<dir> draw-dose-audit-2 --seed=S --out=DIR --exclude-docs=F',
  );
}

/**
 * Gate-passing rules by kind, population and indication marking (general sentence or bound to an
 * indication / one of several regimens): 170 rules. The frame (the rules of untouched documents)
 * holds only 65 + 5 child dose rules and 3 child caps, so those strata are taken nearly whole and
 * the adult and unstated strata, which dominate the frame, carry the rest.
 */
const DEFAULT_QUOTAS: Readonly<Record<string, number>> = {
  'dose|adult|general': 36,
  'dose|adult|bound': 20,
  'dose|child|general': 34,
  'dose|child|bound': 5,
  'dose|unstated': 28,
  'cap|adult': 20,
  'cap|child': 3,
  duration: 24,
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
  const bound = rule.i !== undefined || rule.sv === 1 ? 'bound' : 'general';
  if (population === 'child') return `dose|child|${bound}`;
  if (population === 'unstated') return 'dose|unstated';
  return `dose|adult|${bound}`;
}

/** Every `documentId` string anywhere in a JSON file (the only thing read from earlier sets). */
function documentIdsOf(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) documentIdsOf(entry, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'documentId' && typeof entry === 'string') into.add(entry);
      else documentIdsOf(entry, into);
    }
  }
}

const excludedDocuments = new Set<string>();
const excludedFiles = args
  .filter((arg) => arg.startsWith('--exclude-docs='))
  .map((arg) => arg.slice(15));
for (const file of excludedFiles) {
  documentIdsOf(JSON.parse(readFileSync(resolve(file), 'utf8')), excludedDocuments);
}
const documentsOfEarlierSets = excludedDocuments.size;

const index = loadIndex();
// Every instruction of a card that a benchmark case names is out as well.
const excludedCardsFile = argument('exclude-cards-of');
const benchmarkCards = new Set<string>();
if (excludedCardsFile) {
  const benchmark = JSON.parse(readFileSync(resolve(excludedCardsFile), 'utf8')) as {
    queries: { card: string }[];
  };
  for (const query of benchmark.queries) benchmarkCards.add(query.card);
}
let documentsOfBenchmarkCards = 0;
for (const [documentId, document] of Object.entries(index.asset.documents)) {
  const slugs = document.c.map((cardIndex) => index.asset.cards[cardIndex]?.s ?? '');
  if (slugs.some((slug) => benchmarkCards.has(slug)) && !excludedDocuments.has(documentId)) {
    excludedDocuments.add(documentId);
    documentsOfBenchmarkCards += 1;
  }
}
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

const frameModules: Record<string, number> = {};
for (const ref of refs) {
  const document = index.asset.documents[ref.documentId];
  const name = document ? (index.asset.modules[document.m] ?? '') : '';
  frameModules[name] = (frameModules[name] ?? 0) + 1;
}
if (args.includes('--dry')) {
  console.log(
    JSON.stringify(
      {
        documentsOfEarlierSets,
        documentsOfBenchmarkCards,
        frameRules: refs.length,
        documentsInFrame,
        frameSizes,
        frameModules,
      },
      null,
      1,
    ),
  );
  process.exit(0);
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
for (const stratum of ['dose|child|general', 'dose|adult|general', 'cap|adult', 'duration']) {
  if (picks.length >= total) break;
  take(stratum, total - picks.length);
}
const ordered = shuffled(picks, random);

mkdirSync(outDirectory, { recursive: true });
writeFileSync(
  join(outDirectory, 'draw.json'),
  `${JSON.stringify({ seed, quotas: QUOTAS, frameSizes, frameModules, documentsInFrame, excludedDocuments: excludedDocuments.size, documentsOfEarlierSets, documentsOfBenchmarkCards, indexBasis: index.asset.basis, picks: ordered }, null, 1)}\n`,
);

// ---------------------------------------------------------------------------------------------
// A realistic patient of the rule's population, and what the tool computes for it.
// ---------------------------------------------------------------------------------------------
const DAY = 365.25;
const ADULT_DAYS = Math.round(18 * DAY);
function realisticPatient(rule: DoseRule): PatientFacts {
  const population = populationClassOf(rule);
  const pediatric = population === 'child' || (rule.p1 !== undefined && rule.p1 <= ADULT_DAYS);
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
      indication: rule.i
        ? section.text.slice(rule.i[0], rule.i[1]).replace(/\s+/gu, ' ').trim()
        : null,
      severalRegimens: rule.sv === 1,
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
  const sameForms = forms.filter((entry) => formClassOf(entry.form) === wanted).slice(0, 3);
  const sameForm = sameForms[0];
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
  const choices: { form: string | null; strength: string | null }[] = [];
  for (const entry of sameForms) {
    const own = entry.strengths.slice(0, 3);
    if (own.length === 0) choices.push({ form: entry.form, strength: null });
    for (const strengthEntry of own) {
      choices.push({ form: entry.form, strength: strengthEntry.strength });
    }
  }
  if (choices.length === 0) choices.push({ form: null, strength: null });
  const lines: string[] = [];
  for (const { form: chosenForm, strength } of choices) {
    const item = {
      ...newItem('audit', cardSlug, cardSlug),
      form: chosenForm,
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
    const plan = analysis.plan;
    const unitsLine = plan?.units
      ? `${plan.units.count} ${plan.units.kind}${plan.units.piece ? `/${plan.units.piece}` : ''} amount=${plan.units.amount ?? '-'} dev=${plan.units.deviationPercent ?? '-'}% ${plan.units.fromInstruction ? 'FROM-INSTRUCTION' : 'rounded'}`
      : '-';
    const planLine = plan
      ? ` ; PLAN single=${plan.single ?? '-'}${plan.unit} [${plan.singleMin ?? '-'}..${plan.singleMax ?? '-'}] intakes=${plan.intakes ?? '-'} units=${unitsLine} daily=${plan.actualDaily ?? '-'}${plan.refusedRounding ? ` REFUSED-ROUNDING(${plan.refusedRounding.amount}, ${plan.refusedRounding.deviationPercent}%)` : ''}${plan.notes.length > 0 ? ` NOTES: ${plan.notes.join(' / ')}` : ''}`
      : '';
    const status = analysis.plan ? analysis.plan.status : analysis.state;
    lines.push(
      `<${chosenForm ?? 'no form'}> [${strength ?? 'no strength'}] ${status}${rule.k === 0 ? (mine ? '' : ' (CHOSEN ANOTHER RULE)') : ''}: ${rows || '-'}${caps ? ` ; ${caps}` : ''}${analysis.days !== null ? ` ; days ${analysis.days}` : ''}${planLine}${analysis.signa ? ` ; SIGNA: ${analysis.signa}` : ''}${analysis.quantity ? ` ; QTY: ${analysis.quantity.totalUnits} ${analysis.quantity.unitKind}` : ''}`,
    );
  }
  return `${header}; fit=${match.fit}${match.unstated ? ' (rule names no population)' : ''}; divisible=${document.v === 1}; instruction form=${document.f ?? '-'}\n    ${lines.join('\n    ')}`;
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
