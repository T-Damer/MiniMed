// RX2: draws the sample of dose rules that is judged by hand (blind precision set) and writes a
// review file with each rule next to the sentence and the lines around it.
//
//   DOSE_DECODED_DIR=<dir> bun tools/benchmarks/src/draw-dose-precision-sample.ts \
//     --seed=<string> --out=<dir> [--exclude=<draw.json>]... [--plan=blind|dev]
//
// Writes <out>/draw.json (seed, frame sizes, picks) and <out>/review-NN.txt (25 rules per file).
// The draw is reproducible from the seed and the dose-rule index it was drawn from.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { GATE_ALLOWED, shapeOf } from '../../../apps/app/src/features/prescription/dose-gate';
import { describeRule } from './dose-rule-describe';
import {
  essentialRuleRefs,
  type FrameRule,
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
const plan = argument('plan') ?? 'blind';
const excludeFiles = args.filter((arg) => arg.startsWith('--exclude=')).map((arg) => arg.slice(10));
const decoded = process.env['DOSE_DECODED_DIR'];
if (!seed || !outDirectory || !decoded) {
  throw new Error('Usage: DOSE_DECODED_DIR=<dir> draw-dose-precision-sample --seed=S --out=DIR');
}

/** Blind plan: dose rules by population, caps and durations; 200 rules, one per card. */
const BLIND_QUOTAS: Readonly<Record<string, number>> = {
  'dose|adult': 55,
  'dose|child': 55,
  'dose|unstated': 15,
  'dose|condition': 10,
  'dose|other': 10,
  cap: 30,
  duration: 25,
};
/** Development plan: the shapes the gate lets through, each measured on its own. */
const DEV_QUOTAS: Readonly<Record<string, number>> = {
  'dose.none.abs.freq': 20,
  'dose.none.abs.nofreq': 14,
  'dose.local.abs.freq': 16,
  'dose.local.abs.nofreq': 12,
  'dose.heading.abs.freq': 12,
  'dose.heading.abs.nofreq': 10,
  'dose.local.kg.freq': 10,
  'dose.local.kg.nofreq': 10,
  'dose.heading.kg.freq': 5,
  'dose.heading.kg.nofreq': 6,
  'dose.local.bsa.freq': 3,
  'dose.local.bsa.nofreq': 3,
  'dose.heading.bsa.nofreq': 2,
  'cap.local': 10,
  'cap.heading': 8,
  'cap.none': 16,
  'duration.heading': 6,
  'duration.none': 14,
};
const customQuotas = argument('quotas');
const QUOTAS: Readonly<Record<string, number>> = customQuotas
  ? Object.fromEntries(
      customQuotas.split(',').map((part) => {
        const [name, count] = part.split('=');
        return [name as string, Number(count)];
      }),
    )
  : plan === 'dev'
    ? DEV_QUOTAS
    : BLIND_QUOTAS;

function stratumOf(kind: number, rule: Parameters<typeof populationClassOf>[0]): string {
  if (plan === 'dev') return shapeOf(rule);
  if (kind === 1) return 'cap';
  if (kind === 2) return 'duration';
  return `dose|${populationClassOf(rule)}`;
}

const index = loadIndex();
const excludedCards = new Set<string>();
const excludedDocuments = new Set<string>();
// --exclude-docs: an earlier development draw; its documents are skipped, its cards may come again.
for (const file of args
  .filter((arg) => arg.startsWith('--exclude-docs='))
  .map((arg) => arg.slice(15))) {
  const draw = JSON.parse(readFileSync(resolve(file), 'utf8')) as {
    picks: { documentId: string }[];
  };
  for (const pick of draw.picks) excludedDocuments.add(pick.documentId);
}
for (const file of excludeFiles) {
  const draw = JSON.parse(readFileSync(resolve(file), 'utf8')) as {
    picks: { cardSlug: string; documentId: string }[];
  };
  for (const pick of draw.picks) {
    excludedCards.add(pick.cardSlug);
    excludedDocuments.add(pick.documentId);
  }
}

// --exclude-rules: rules judged in earlier draws are skipped, their documents and cards may come again.
const excludedRules = new Set<string>();
for (const file of args
  .filter((arg) => arg.startsWith('--exclude-rules='))
  .map((arg) => arg.slice(16))) {
  const draw = JSON.parse(readFileSync(resolve(file), 'utf8')) as { picks: { key: string }[] };
  for (const pick of draw.picks) excludedRules.add(pick.key);
}

const allowedOnly = args.includes('--allowed-only');
const refs = essentialRuleRefs(index).filter(
  (ref) =>
    !excludedCards.has(ref.cardSlug) &&
    !excludedDocuments.has(ref.documentId) &&
    !excludedRules.has(ruleKeyOf(ref.documentId, ref.rule)) &&
    (!allowedOnly || GATE_ALLOWED.has(shapeOf(ref.rule))),
);
const frameSizes: Record<string, number> = {};
for (const ref of refs) {
  const stratum = stratumOf(ref.rule.k, ref.rule);
  frameSizes[stratum] = (frameSizes[stratum] ?? 0) + 1;
}

const random = seededRandom(seed);
const moduleCounts = new Map<string, number>();
const perCard = Number(argument('per-card') ?? '1');
const cardCounts = new Map<string, number>();
const usedCards = {
  has: (card: string): boolean => (cardCounts.get(card) ?? 0) >= perCard,
  add: (card: string): void => {
    cardCounts.set(card, (cardCounts.get(card) ?? 0) + 1);
  },
};
const pickedKeys = new Set<string>();
const picks: { key: string; stratum: string; documentId: string; cardSlug: string }[] = [];
const moduleOf = (documentId: string): string => {
  const document = index.asset.documents[documentId];
  return document ? (index.asset.modules[document.m] ?? '') : '';
};
// Small strata first so that the one-rule-per-card rule never starves them.
for (const [stratum, quota] of Object.entries(QUOTAS).toSorted((a, b) => a[1] - b[1])) {
  const candidates = shuffled(
    refs.filter((ref) => stratumOf(ref.rule.k, ref.rule) === stratum),
    random,
  );
  for (let taken = 0; taken < quota; taken += 1) {
    let best = -1;
    let bestCount = Number.POSITIVE_INFINITY;
    for (let at = 0; at < candidates.length; at += 1) {
      const candidate = candidates[at];
      if (!candidate || usedCards.has(candidate.cardSlug)) continue;
      if (pickedKeys.has(ruleKeyOf(candidate.documentId, candidate.rule))) continue;
      const count = moduleCounts.get(moduleOf(candidate.documentId)) ?? 0;
      if (count < bestCount) {
        best = at;
        bestCount = count;
      }
    }
    const chosen = candidates[best];
    if (!chosen) break;
    usedCards.add(chosen.cardSlug);
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
// Review order: shuffled, so no file is all caps or all one module.
const ordered = shuffled(picks, random);

mkdirSync(outDirectory, { recursive: true });
writeFileSync(
  join(outDirectory, 'draw.json'),
  `${JSON.stringify({ seed, plan, quotas: QUOTAS, frameSizes, indexBasis: index.asset.basis, picks: ordered }, null, 1)}\n`,
);

const texts = new ModuleTexts(decoded, index);
const BATCH = 25;
for (let from = 0; from < ordered.length; from += BATCH) {
  const lines: string[] = [];
  ordered.slice(from, from + BATCH).forEach((pick, offset) => {
    const document = index.asset.documents[pick.documentId];
    const rule = document?.rules.find((item) => ruleKeyOf(pick.documentId, item) === pick.key);
    if (!document || !rule) throw new Error(`Rule ${pick.key} is not in the index`);
    const item: FrameRule = frameRule(index, texts, pick.documentId, rule, pick.cardSlug, true);
    const number = from + offset + 1;
    lines.push(
      `#${String(number).padStart(3, '0')}  [${pick.stratum}]  ${pick.cardSlug}  module=${item.module}  doc=${pick.documentId.slice(8, 20)}  section=${item.sectionTitle}`,
      `  PARSED: ${describeRule(rule)}`,
      `  RULE:   ${JSON.stringify(rule)}`,
      ...(item.headingText ? [`  HEADING-USED: ${item.headingText}`] : []),
      `  SENTENCE: ${item.sentence}`,
      `  CONTEXT: ${item.window}`,
      '',
    );
  });
  writeFileSync(
    join(outDirectory, `review-${String(from / BATCH + 1).padStart(2, '0')}.txt`),
    `${lines.join('\n')}\n`,
  );
}
texts.close();
console.log(`${ordered.length} rules drawn; frame ${JSON.stringify(frameSizes)}`);
