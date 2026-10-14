// RX2: precision of the dose rules, from the hand-judged sets (no corpus needed).
//
//   bun tools/benchmarks/src/run-dose-precision.ts            # blind set: before the gate, after the gate, coverage
//   bun tools/benchmarks/src/run-dose-precision.ts --dev      # development sample: evidence for GATE_ALLOWED
//   bun tools/benchmarks/src/run-dose-precision.ts --file=tools/benchmarks/dose-rule-precision-fresh.json   # later fresh draws
//
// The blind set (tools/benchmarks/dose-rule-precision.json) holds 200 random rules of ЖНВЛП cards,
// each judged field by field against its source sentence BEFORE any fix; it is never used for tuning.
// A rule the parser has changed since is re-judged (`rejudged` in the item). The report gives the
// error rate with a 95 % interval, per field, per sentence shape (the gate's shape of the rule as the
// index holds it now), the same after the confidence gate (only rules of allowed shapes compute
// numbers) and the coverage of the ЖНВЛП cards. The run fails when a rule that the gate lets compute
// was judged wrong, or when an allowed shape lacks development evidence.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DoseRule } from '@localmed/contracts';

import {
  DOSE_SHAPES,
  GATE_ALLOWED,
  GATE_MIN_JUDGED,
  isRejectedShape,
  shapeFamily,
  shapeOf,
} from '../../../apps/app/src/features/prescription/dose-gate';
import { clopperPearson, percent, wilson } from './binomial';
import { FIELDS } from './build-dose-precision-set';
import { loadIndex } from './dose-rule-frame';
import { REPOSITORY_ROOT } from './real-corpus';

type Verdict = 'correct' | 'incomplete' | 'wrong';

interface Item {
  readonly id: string;
  readonly documentId: string;
  readonly card: string;
  readonly module: string;
  readonly stratum: string;
  readonly rule: DoseRule;
  readonly fields: Readonly<Record<string, string>>;
  readonly verdict: Verdict;
  readonly doseRelevantWrong: boolean;
  readonly reason: string;
  readonly rejudged?: {
    readonly rule: DoseRule;
    readonly verdict: Verdict;
    readonly reason: string;
  };
}

interface SetFile {
  readonly name: string;
  readonly note: string;
  readonly draws: readonly {
    readonly seed: string;
    readonly drawnFrom: { readonly frameSizes: Record<string, number> };
  }[];
  readonly items: readonly Item[];
}

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const fileArgument = args.find((arg) => arg.startsWith('--file='))?.slice(7);
const file =
  fileArgument ??
  (dev ? 'tools/benchmarks/dose-rule-gate-dev.json' : 'tools/benchmarks/dose-rule-precision.json');
const set = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, file), 'utf8')) as SetFile;
const index = loadIndex();

function currentRule(item: Item): DoseRule | undefined {
  return index.asset.documents[item.documentId]?.rules.find(
    (rule) => `${item.documentId}#${rule.s}:${rule.a}:${rule.k}` === item.id,
  );
}

function interval(successes: number, n: number): string {
  const exact = clopperPearson(successes, n);
  const score = wilson(successes, n);
  return `95 % CI Clopper–Pearson ${percent(exact.low)}–${percent(exact.high)}, Wilson ${percent(score.low)}–${percent(score.high)}`;
}

function rate(successes: number, n: number): string {
  return `${successes}/${n} = ${n === 0 ? '–' : percent(successes / n)}`;
}

console.log(`# ${set.name}: ${set.items.length} judged rules (${set.note})`);
console.log(`seeds: ${set.draws.map((draw) => draw.seed).join(', ')}\n`);

// ---------------------------------------------------------------------------------------------
// As judged: the parser of RX1, before RX2.
// ---------------------------------------------------------------------------------------------
const wrong = set.items.filter((item) => item.verdict === 'wrong');
const incomplete = set.items.filter((item) => item.verdict === 'incomplete');
const doseRelevant = set.items.filter((item) => item.doseRelevantWrong);
console.log('## As judged (parser of RX1, before the gate)');
console.log(
  `wrong in some field:          ${rate(wrong.length, set.items.length)}  ${interval(wrong.length, set.items.length)}`,
);
console.log(
  `wrong in a dose-relevant field: ${rate(doseRelevant.length, set.items.length)}  ${interval(doseRelevant.length, set.items.length)}`,
);
console.log(`incomplete only (harmless):   ${rate(incomplete.length, set.items.length)}`);
console.log(
  `wrong or incomplete:          ${rate(wrong.length + incomplete.length, set.items.length)}`,
);

// Post-stratified estimate over the frame of the draw: strata weighted by their size in the frame.
const frame = set.draws[0]?.drawnFrom.frameSizes ?? {};
if (!dev && set.draws.length === 1) {
  const strata = new Map<string, { n: number; w: number }>();
  for (const item of set.items) {
    const entry = strata.get(item.stratum) ?? { n: 0, w: 0 };
    entry.n += 1;
    if (item.verdict === 'wrong') entry.w += 1;
    strata.set(item.stratum, entry);
  }
  let total = 0;
  let weighted = 0;
  for (const [stratum, entry] of strata) {
    const size = frame[stratum] ?? 0;
    total += size;
    weighted += size * (entry.w / entry.n);
  }
  console.log(
    `weighted by the frame (${total} rules of ЖНВЛП cards): ${percent(weighted / total)}`,
  );
}

console.log('\nBy stratum:');
for (const stratum of [...new Set(set.items.map((item) => item.stratum))].toSorted()) {
  const own = set.items.filter((item) => item.stratum === stratum);
  const bad = own.filter((item) => item.verdict === 'wrong').length;
  console.log(`  ${stratum.padEnd(24)} ${rate(bad, own.length)}`);
}

console.log('\nBy field (rules whose rule carries the field or a judge flagged it):');
for (const field of FIELDS) {
  const present = set.items.filter((item) => item.fields[field] !== 'absent');
  const bad = present.filter((item) => item.fields[field] === 'wrong').length;
  const partial = present.filter((item) => item.fields[field] === 'incomplete').length;
  console.log(
    `  ${field.padEnd(6)} wrong ${rate(bad, present.length).padEnd(14)} incomplete ${partial}`,
  );
}

// ---------------------------------------------------------------------------------------------
// After the gate: the shape of each rule as the index holds it now.
// ---------------------------------------------------------------------------------------------
interface Row {
  readonly item: Item;
  readonly shape: (typeof DOSE_SHAPES)[number] | 'vanished';
  readonly verdict: Verdict;
  readonly changed: boolean;
}
const rows: Row[] = set.items.map((item) => {
  const current = currentRule(item);
  if (!current) return { item, shape: 'vanished', verdict: item.verdict, changed: true };
  const { gc: _now, ...nowRule } = current;
  const { gc: _then, ...thenRule } = item.rule;
  const changed = JSON.stringify(nowRule) !== JSON.stringify(thenRule);
  const shape = shapeOf(current);
  if (changed && !isRejectedShape(shape) && !item.rejudged) {
    throw new Error(`${item.id} changed since it was judged and passes the gate: re-judge it`);
  }
  return {
    item,
    shape,
    verdict: changed ? (item.rejudged?.verdict ?? item.verdict) : item.verdict,
    changed,
  };
});

console.log(
  "\n## By sentence shape (the gate's shape today; verdict of the rule as it reads today)",
);
for (const shape of [...DOSE_SHAPES, 'vanished' as const]) {
  const own = rows.filter((row) => row.shape === shape);
  if (own.length === 0) continue;
  const bad = own.filter((row) => row.verdict === 'wrong').length;
  const partial = own.filter((row) => row.verdict === 'incomplete').length;
  const allowed = GATE_ALLOWED.has(shape as never);
  console.log(
    `  ${shape.padEnd(26)} n=${String(own.length).padStart(3)}  wrong ${String(bad).padStart(3)}  incomplete ${String(partial).padStart(2)}  ${allowed ? 'ALLOWED' : ''}`,
  );
}

const computed = rows.filter((row) => row.shape !== 'vanished' && GATE_ALLOWED.has(row.shape));
const computedWrong = computed.filter((row) => row.verdict === 'wrong');
const computedIncomplete = computed.filter((row) => row.verdict === 'incomplete');
console.log('\n## After the confidence gate (only allowed shapes compute numbers)');
console.log(`rules that still compute:      ${rate(computed.length, rows.length)}`);
console.log(
  `  wrong among them:            ${rate(computedWrong.length, computed.length)}  ${interval(computedWrong.length, computed.length)}`,
);
console.log(`  incomplete among them:       ${rate(computedIncomplete.length, computed.length)}`);
const wrongBefore = rows.filter((row) => row.item.verdict === 'wrong').length;
console.log(
  `wrong as judged before the gate: ${wrongBefore}; wrong that still compute: ${computedWrong.length}`,
);
for (const row of computedWrong)
  console.log(`  WRONG COMPUTED: ${row.item.card} ${row.item.id} — ${row.item.reason}`);

// ---------------------------------------------------------------------------------------------
// Coverage of the ЖНВЛП cards (index only).
// ---------------------------------------------------------------------------------------------
const essential = new Set<string>();
const withInstruction = new Set<string>();
const withRule = new Set<string>();
const withComputed = new Set<string>();
const withComputedAdult = new Set<string>();
const withComputedChild = new Set<string>();
const withComputedCap = new Set<string>();
const withComputedDuration = new Set<string>();
const ADULT = Math.round(18 * 365.25);
for (const card of index.asset.cards) if (card.e === 1) essential.add(card.s);
for (const document of Object.values(index.asset.documents)) {
  for (const cardIndex of document.c) {
    const card = index.asset.cards[cardIndex];
    if (!card || card.e !== 1) continue;
    withInstruction.add(card.s);
    for (const rule of document.rules) {
      if (rule.k === 0) withRule.add(card.s);
      if (rule.k === 0 && GATE_ALLOWED.has(shapeOf(rule))) {
        withComputed.add(card.s);
        const unstated = (rule.g ?? 0) === 0 && rule.p0 === undefined && rule.p1 === undefined;
        const child = (rule.p1 !== undefined && rule.p1 <= ADULT) || ((rule.g ?? 0) & 58) !== 0;
        if (child) withComputedChild.add(card.s);
        else if (unstated || (rule.g ?? 0) & 1 || (rule.p0 ?? 0) >= ADULT)
          withComputedAdult.add(card.s);
      }
      if (rule.k === 1 && GATE_ALLOWED.has(shapeOf(rule))) withComputedCap.add(card.s);
      if (rule.k === 2 && GATE_ALLOWED.has(shapeOf(rule))) withComputedDuration.add(card.s);
    }
  }
}
console.log('\n## Coverage of the ЖНВЛП cards (the index as built)');
console.log(
  `cards: ${essential.size}; with an instruction in the modules: ${withInstruction.size}; with a parsed dose rule: ${withRule.size}`,
);
console.log(
  `cards with a COMPUTED dose (allowed shape): ${withComputed.size} (${percent(withComputed.size / essential.size)} of all, ${percent(withComputed.size / withInstruction.size)} of those with an instruction)`,
);
console.log(
  `  of them with an adult dose: ${withComputedAdult.size}; with a child dose: ${withComputedChild.size}; with a cap: ${withComputedCap.size}; with a duration: ${withComputedDuration.size}`,
);

// ---------------------------------------------------------------------------------------------
// Evidence for the allowed shapes (development sample only).
// ---------------------------------------------------------------------------------------------
let failed = false;
if (dev) {
  console.log(
    `\n## Evidence for GATE_ALLOWED (per family: >= ${GATE_MIN_JUDGED} judged, none wrong)`,
  );
  for (const family of [...new Set([...GATE_ALLOWED].map(shapeFamily))].toSorted()) {
    const own = rows.filter(
      (row) =>
        row.shape !== 'vanished' &&
        GATE_ALLOWED.has(row.shape) &&
        shapeFamily(row.shape) === family,
    );
    const bad = own.filter((row) => row.verdict === 'wrong').length;
    const ok = own.length >= GATE_MIN_JUDGED && bad === 0;
    console.log(
      `  ${family.padEnd(22)} n=${own.length} wrong=${bad} ${ok ? 'ok' : 'NOT ENOUGH EVIDENCE'}`,
    );
    if (!ok) failed = true;
  }
  const accepted = rows.filter((row) => row.shape !== 'vanished' && !isRejectedShape(row.shape));
  const bad = accepted.filter((row) => row.verdict === 'wrong').length;
  console.log(
    `candidate shapes together: ${rate(bad, accepted.length)} wrong  ${interval(bad, accepted.length)}`,
  );
}
if (!dev && computedWrong.length > 0) failed = true;
if (failed) {
  console.error('\nFAILED');
  process.exitCode = 1;
}
