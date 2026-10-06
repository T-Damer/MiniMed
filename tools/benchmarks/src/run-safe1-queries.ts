// SAFE1: the questions «X при беременности», «X во время ГВ», «X ребёнку 3 лет», «с какого возраста X»
// on the real corpus, through the same code the search card runs: parseSafetyQuery → the app's own
// medication search (S3 name variants included) → the safety index → the card view built from the
// installed instruction. A separate set from owner-queries.json (tools/benchmarks/safe1-queries.json),
// each case with the card it must (or must not) produce. Needs the decoded instruction modules:
//
//   SAFE1_DECODED_DIR=<dir of minimed.medications.instructions.*.db> bun src/run-safe1-queries.ts \
//     [--no-modules] [--no-report] [--only=<id>] [--show]
//
// `--no-modules` runs with no instruction installed (the card must offer the download).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolveSafetyCandidate } from '../../../apps/app/src/features/medication-safety/safety-candidates';
import {
  createSafetyIndex,
  parseSafetyIndex,
} from '../../../apps/app/src/features/medication-safety/safety-index';
import { parseSafetyQuery } from '../../../apps/app/src/features/medication-safety/safety-query';
import {
  type DocumentState,
  documentsToRead,
  intentView,
} from '../../../apps/app/src/features/medication-safety/safety-view';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const noModules = args.includes('--no-modules');
const show = args.includes('--show');
const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const decodedDirectory = process.env['SAFE1_DECODED_DIR'];

interface Expectation {
  /** `quotes`: at least one quoted sentence; `nothing-said`: read, nothing on the topic. */
  readonly pregnancy?: 'quotes' | 'nothing-said';
  readonly lactation?: 'quotes' | 'nothing-said';
  readonly age?: 'quotes' | 'nothing-said';
  /** Some quoted sentence of the intent must match. */
  readonly quotePattern?: string;
  /** The calculated comparison lines of the age block must include this relation. */
  readonly calcRelation?: 'below' | 'equal' | 'above' | 'inside' | 'spans';
}

interface SafeQuery {
  readonly id: string;
  readonly kind: 'lactation' | 'pregnancy' | 'age' | 'negative';
  readonly query: string;
  /** Intents the parser must read; absent for a query that asks nothing of the card. */
  readonly intents?: readonly string[];
  /** The ЕСКЛП МНН card slug the name must resolve to; null: no card may appear. */
  readonly card: string | null;
  readonly expect?: Expectation;
}

const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/safe1-queries.json'), 'utf8'),
) as { readonly queries: readonly SafeQuery[] };
const cases = fixture.queries.filter((item) => only === undefined || item.id === only);
if (new Set(fixture.queries.map((item) => item.id)).size !== fixture.queries.length) {
  throw new Error('SAFE1 query set contains duplicate ids.');
}

const index = createSafetyIndex(
  parseSafetyIndex(
    JSON.parse(
      readFileSync(
        resolve(REPOSITORY_ROOT, 'apps/app/src/features/medication-safety/data/safety-index.json'),
        'utf8',
      ),
    ),
  ),
);
const installedModules =
  !noModules && decodedDirectory
    ? readdirSync(decodedDirectory)
        .filter((name) => name.endsWith('.db'))
        .toSorted()
        .map((name) => ({
          moduleId: name.replace(/\.db$/u, ''),
          path: join(decodedDirectory, name),
        }))
    : [];
if (!noModules && installedModules.length === 0) {
  throw new Error(
    'Set SAFE1_DECODED_DIR to the decoded instruction modules, or pass --no-modules.',
  );
}
const { core } = await openRealCorpus({ installedModules });

/** Words the card must never say in its own voice (quotes are the instruction's, not the card's). */
const VERDICT = /(?:^|[^\p{L}])(?:разрешен[аоы]?|можно|нельзя|безопасн\p{L}*)(?![\p{L}])/iu;

interface Row {
  readonly id: string;
  readonly kind: SafeQuery['kind'];
  readonly query: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly card: string | null;
  readonly summary: readonly string[];
}
const rows: Row[] = [];
for (const item of cases) {
  const failures: string[] = [];
  const summary: string[] = [];
  const parsed = parseSafetyQuery(item.query);
  if (item.intents === undefined) {
    if (parsed !== null) failures.push(`parsed as a question: ${JSON.stringify(parsed.intents)}`);
  } else if (!parsed) {
    failures.push('not parsed');
  } else if (JSON.stringify(parsed.intents) !== JSON.stringify(item.intents)) {
    failures.push(`intents ${JSON.stringify(parsed.intents)} ≠ ${JSON.stringify(item.intents)}`);
  }
  let resolvedSlug: string | null = null;
  if (parsed) {
    const candidate = await resolveSafetyCandidate(core, index, parsed.name);
    resolvedSlug = candidate?.slug ?? null;
    if (resolvedSlug !== item.card) failures.push(`card ${resolvedSlug} ≠ ${item.card}`);
    if (candidate && item.expect) {
      const documents = new Map<string, DocumentState>();
      for (let round = 0; round < 6; round += 1) {
        const wanted = documentsToRead(index, candidate, parsed.intents, documents);
        if (wanted.length === 0) break;
        for (const id of wanted) {
          const result = await core.getDocument(id);
          documents.set(id, result.ok ? { document: result.value } : 'missing');
        }
      }
      for (const intent of parsed.intents) {
        const view = intentView({
          index,
          candidate,
          intent,
          age: parsed.age,
          trimester: parsed.trimester,
          documents,
        });
        const quotes = view.groups.flatMap((group) => group.quotes);
        summary.push(
          `${intent}: ${view.state}${view.nothingSaid ? ' nothing-said' : ''} ${quotes.length} quotes; source ${view.source?.tradeName ?? '-'} (${view.source?.documentId ?? '-'})`,
        );
        if (show) {
          for (const quote of quotes.slice(0, 4)) {
            summary.push(`    «${quote.segments.map((segment) => segment.text).join('')}»`);
          }
          for (const line of view.ageSummary) summary.push(`    ${line.text} (${line.words})`);
        }
        const wanted = item.expect[intent];
        if (noModules) {
          if (view.state !== 'not-installed' && view.state !== 'no-instruction') {
            failures.push(`${intent}: expected a download offer, got ${view.state}`);
          }
          continue;
        }
        if (wanted === 'quotes' && quotes.length === 0)
          failures.push(`${intent}: no quotes (${view.state})`);
        if (wanted === 'nothing-said' && !view.nothingSaid)
          failures.push(`${intent}: expected nothing-said`);
        if (item.expect.quotePattern && wanted === 'quotes') {
          const pattern = new RegExp(item.expect.quotePattern, 'iu');
          if (!quotes.some((quote) => pattern.test(quote.fullText))) {
            failures.push(`${intent}: no quote matches /${item.expect.quotePattern}/`);
          }
        }
        if (item.expect.calcRelation && intent === 'age') {
          const relations = quotes.flatMap((quote) => quote.calc.map((line) => line.relation));
          if (!relations.includes(item.expect.calcRelation)) {
            failures.push(`age: no calculated line with relation ${item.expect.calcRelation}`);
          }
        }
        for (const quote of quotes) {
          for (const line of quote.calc) {
            if (VERDICT.test(line.text))
              failures.push(`verdict word in a calculated line: ${line.text}`);
          }
        }
      }
    }
  }
  rows.push({
    id: item.id,
    kind: item.kind,
    query: item.query,
    passed: failures.length === 0,
    failures,
    card: resolvedSlug,
    summary,
  });
}
await core.close();

const byKind = new Map<string, { total: number; passed: number }>();
for (const row of rows) {
  const entry = byKind.get(row.kind) ?? { total: 0, passed: 0 };
  entry.total += 1;
  if (row.passed) entry.passed += 1;
  byKind.set(row.kind, entry);
}
const summary = {
  mode: noModules ? 'no-modules' : 'modules-installed',
  total: rows.length,
  passed: rows.filter((row) => row.passed).length,
  byKind: Object.fromEntries(byKind),
};
if (!args.includes('--no-report') && only === undefined) {
  const reportPath = resolve(
    REPOSITORY_ROOT,
    `data/build/safe1-queries-report${noModules ? '-no-modules' : ''}.json`,
  );
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
}
console.log(JSON.stringify(summary, null, 2));
for (const row of rows) {
  console.log(
    `${row.passed ? 'ok  ' : 'FAIL'}\t${row.kind}\t${row.id}\t${row.query}\t→ ${row.card ?? '-'}`,
  );
  for (const failure of row.failures) console.log(`      ! ${failure}`);
  if (show || !row.passed) for (const line of row.summary) console.log(`      ${line}`);
}
void existsSync;
