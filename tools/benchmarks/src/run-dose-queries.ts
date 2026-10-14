// RX1: dose questions («амоксициллин ребёнок 20 кг», «ибупрофен 3 года», «цефтриаксон 70 кг») on the
// real corpus, through the same code the search card runs: parseDoseQuery → the app's own medication
// search (S3 name variants and spelling correction included) → the dose-rule index → the installed
// instruction read from the core → the item analysis of the prescription tool. A set of its own,
// tools/benchmarks/dose-queries.json: every case is a patient and a drug, with the sentence of the
// instruction the dose must come from and the numbers worked out by hand from that sentence.
//
//   DOSE_DECODED_DIR=<dir of minimed.medications.instructions.*.db> bun src/run-dose-queries.ts \
//     [--no-report] [--only=<id>] [--show] [--probe="<query>"]...
//
// Outcomes per case: `exact` (the first dose shown is an accepted sentence with the expected
// numbers), `answered-other` (the first dose shown is another sentence of the instruction that the
// case accepts or that is not forbidden, with numbers that differ: a wrong answer unless the case
// lists it), `wrong` (an unaccepted sentence or wrong numbers, or a forbidden sentence offered) and
// `missing` (no dose shown: acceptable). The run fails when a wrong answer is found.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { answerDoseQuery } from '../../../apps/app/src/features/prescription/dose-answer';
import {
  createDoseIndex,
  parseDoseRuleIndex,
} from '../../../apps/app/src/features/prescription/dose-index';
import { parseDoseQuery } from '../../../apps/app/src/features/prescription/dose-query';
import {
  type ItemAnalysis,
  indicationLabel,
  intakeRows,
  quantityText,
} from '../../../apps/app/src/features/prescription/prescription-model';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const show = args.includes('--show');
const noReport = args.includes('--no-report');
const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const probes = args
  .filter((arg) => arg.startsWith('--probe='))
  .map((arg) => arg.slice('--probe='.length));
const decodedDirectory = process.env['DOSE_DECODED_DIR'];

interface Accepted {
  /** A piece of the quoted sentence (whitespace collapsed). */
  readonly quote: string;
  /** The single dose in the rule's unit, after per-kilogram scaling and before rounding to a product. */
  readonly single?: number;
  /** Intakes a day. */
  readonly intakes?: number;
  /** Single dose × intakes (the daily dose, when the sentence gives a daily dose without intakes). */
  readonly daily?: number;
  /** The sentence is read but a number is still needed before anything can be computed. */
  readonly needs?: 'weight' | 'intakes';
  /**
   * The sentence is one indication or regimen of several (RX4): it is accepted as the first answer only
   * while the screen marks it so (an indication beside the number), never as the general dose.
   */
  readonly bound?: true;
}

interface DoseCase {
  readonly id: string;
  readonly query: string;
  /** The ЕСКЛП МНН card slug the name must resolve to. */
  readonly card: string;
  readonly accept: readonly Accepted[];
  /** Pieces of sentences that must not be among the doses offered for this patient. */
  readonly forbid?: readonly string[];
  /** The case has no answer in the instructions read: the card must show no dose. */
  readonly none?: true;
  readonly note?: string;
}

const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/dose-queries.json'), 'utf8'),
) as { readonly queries: readonly DoseCase[] };
const cases = fixture.queries.filter((item) => only === undefined || item.id === only);
if (new Set(fixture.queries.map((item) => item.id)).size !== fixture.queries.length) {
  throw new Error('Dose query set contains duplicate ids.');
}

const index = createDoseIndex(
  parseDoseRuleIndex(
    JSON.parse(
      readFileSync(
        resolve(REPOSITORY_ROOT, 'apps/app/src/features/prescription/data/dose-rules-index.json'),
        'utf8',
      ),
    ),
  ),
);
if (!decodedDirectory || !existsSync(decodedDirectory)) {
  throw new Error('Set DOSE_DECODED_DIR to the decoded instruction modules.');
}
const installedModules = readdirSync(decodedDirectory)
  .filter((name) => name.endsWith('.db'))
  .toSorted()
  .map((name) => ({ moduleId: name.replace(/\.db$/u, ''), path: join(decodedDirectory, name) }));
const { core } = await openRealCorpus({ installedModules });

function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ');
}

interface Numbers {
  readonly status: string;
  readonly single: number | null;
  readonly intakes: number | null;
  readonly daily: number | null;
}

function numbersOf(analysis: ItemAnalysis): Numbers | null {
  const plan = analysis.plan;
  if (!plan) return null;
  if (plan.status === 'needs-intakes') {
    return { status: plan.status, single: null, intakes: null, daily: plan.actualDaily };
  }
  if (plan.status !== 'ok' || plan.single === null) {
    return { status: plan.status, single: null, intakes: null, daily: null };
  }
  return {
    status: plan.status,
    single: plan.single,
    intakes: plan.intakes,
    daily: plan.intakes === null ? null : plan.single * plan.intakes,
  };
}

function near(left: number | undefined, right: number | null | undefined): boolean {
  if (left === undefined) return true;
  if (right === null || right === undefined || Number.isNaN(right)) return false;
  return Math.abs(left - right) <= Math.max(1e-6, Math.abs(left) * 0.0005);
}

function describe(analysis: ItemAnalysis): string[] {
  const lines: string[] = [];
  const options = analysis.options;
  lines.push(
    `state=${analysis.state} options=${options.length} pending=${analysis.pending.length} restricted=${analysis.restricted.length} doc=${analysis.documentId ?? '-'}`,
  );
  options.slice(0, 3).forEach((option, position) => {
    const why = indicationLabel(option);
    lines.push(
      `  ${position === 0 ? '>' : ' '} ${option.summary} [${option.match.unstated ? 'unstated' : 'stated'}]${why === null ? '' : ` {bound: ${why.slice(0, 60)}}`}`,
    );
    lines.push(`      Q: ${collapse(option.resolved.quote).slice(0, 260)}`);
    if (position === 0) lines.push(`      rule: ${JSON.stringify(option.resolved.rule)}`);
    const numbers = option.key === analysis.chosen?.key ? numbersOf(analysis) : null;
    if (numbers) {
      lines.push(
        `      single=${numbers.single} intakes=${numbers.intakes} daily=${numbers.daily}`,
      );
    }
  });
  const rows = intakeRows(analysis).map((row) => `${row.label}: ${row.value}`);
  if (rows.length > 0) lines.push(`  rows: ${rows.join(' | ')}`);
  const quantity = quantityText(analysis);
  if (quantity) lines.push(`  quantity: ${quantity}`);
  return lines;
}

for (const text of probes) {
  const query = parseDoseQuery(text);
  console.log(`\n=== ${text}`);
  if (!query) {
    console.log('  not a dose question');
    continue;
  }
  const answer = await answerDoseQuery(core, index, query);
  if (!answer) {
    console.log(`  no drug for «${query.name}»`);
    continue;
  }
  console.log(
    `  drug=${answer.candidate.slug} form=${answer.item.form ?? '-'} strength=${answer.item.strength ?? '-'}`,
  );
  for (const line of describe(answer.analysis)) console.log(line);
}

type Outcome = 'exact' | 'wrong' | 'missing';
interface Row {
  readonly id: string;
  readonly query: string;
  readonly outcome: Outcome;
  readonly failures: readonly string[];
  readonly summary: readonly string[];
}
const rows: Row[] = [];
for (const item of cases) {
  const failures: string[] = [];
  let outcome: Outcome = 'missing';
  let summary: string[] = [];
  const query = parseDoseQuery(item.query);
  if (!query) failures.push('not parsed as a dose question');
  const answer = query ? await answerDoseQuery(core, index, query) : null;
  if (query && !answer) failures.push('no drug found');
  if (answer) {
    if (answer.candidate.slug !== item.card)
      failures.push(`card ${answer.candidate.slug} ≠ ${item.card}`);
    const analysis = answer.analysis;
    summary = describe(analysis);
    const options = analysis.options;
    for (const forbidden of item.forbid ?? []) {
      if (options.some((option) => collapse(option.resolved.quote).includes(forbidden))) {
        failures.push(`offers a forbidden sentence: «${forbidden}»`);
      }
    }
    if (item.none) {
      if (options.length > 0) failures.push('a dose is shown where the instruction states none');
      else outcome = 'exact';
    } else if (options.length === 0 || !analysis.chosen) {
      outcome = 'missing';
    } else {
      const chosen = analysis.chosen;
      const numbers = numbersOf(analysis);
      const quote = collapse(chosen.resolved.quote);
      const matching = item.accept.filter((accepted) => {
        if (!quote.includes(accepted.quote) || numbers === null) return false;
        if (accepted.bound === true && !chosen.bound) return false;
        if (accepted.needs === 'weight') return numbers.status === 'needs-weight';
        if (accepted.needs === 'intakes') {
          return numbers.status === 'needs-intakes' && near(accepted.daily, numbers.daily);
        }
        if (numbers.status === 'needs-intakes') {
          return (
            accepted.single === undefined &&
            accepted.intakes === undefined &&
            near(accepted.daily, numbers.daily)
          );
        }
        return (
          numbers.status === 'ok' &&
          near(accepted.single, numbers.single) &&
          near(accepted.intakes, numbers.intakes) &&
          near(accepted.daily, numbers.daily)
        );
      });
      if (matching.length > 0) outcome = 'exact';
      else {
        outcome = 'wrong';
        failures.push(
          `first dose ≠ accepted: «${quote.slice(0, 140)}» ${numbers?.status} single=${numbers?.single} intakes=${numbers?.intakes} daily=${numbers?.daily}`,
        );
      }
    }
  }
  if (
    failures.some(
      (failure) => failure.startsWith('offers') || failure.startsWith('a dose is shown'),
    )
  ) {
    outcome = 'wrong';
  }
  const hardFailure = failures.some(
    (failure) =>
      failure.startsWith('not parsed') ||
      failure.startsWith('no drug') ||
      failure.startsWith('card '),
  );
  if (hardFailure && outcome === 'exact') outcome = 'missing';
  rows.push({ id: item.id, query: item.query, outcome, failures, summary });
  const status = outcome === 'exact' ? 'ok   ' : outcome === 'missing' ? 'miss ' : 'WRONG';
  console.log(
    `${status} ${item.id}: ${item.query}${failures.length > 0 ? `  — ${failures.join('; ')}` : ''}`,
  );
  if (show || outcome === 'wrong') for (const line of summary) console.log(`    ${line}`);
}

const count = (outcome: Outcome): number => rows.filter((row) => row.outcome === outcome).length;
const answerable = cases.filter((item) => item.none !== true).length;
const report = {
  cases: rows.length,
  answerable,
  exact: count('exact'),
  missing: count('missing'),
  wrong: count('wrong'),
  coverage:
    answerable === 0
      ? 0
      : Number(
          (
            rows.filter(
              (row) => row.outcome !== 'missing' && !cases.find((c) => c.id === row.id)?.none,
            ).length / answerable
          ).toFixed(3),
        ),
  exactness:
    answerable === 0
      ? 0
      : Number(
          (
            rows.filter(
              (row) => row.outcome === 'exact' && !cases.find((c) => c.id === row.id)?.none,
            ).length / answerable
          ).toFixed(3),
        ),
};
console.log(`\n${JSON.stringify(report)}`);
if (!noReport && cases.length === fixture.queries.length) {
  const target = resolve(REPOSITORY_ROOT, 'data/build/dose-queries/report.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ report, rows }, null, 2)}\n`);
}
if (report.wrong > 0) {
  console.error(`${report.wrong} wrong answers.`);
  process.exitCode = 1;
}
