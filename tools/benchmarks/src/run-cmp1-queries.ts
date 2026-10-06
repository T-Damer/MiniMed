// CMP1: the queries that compare drugs («X или Y», «X vs Y», «сравнить X и Y», «чем отличается X от Y»)
// on the real corpus, through the code the search card runs: parseComparisonQuery → the app's own
// medication search (S3 name variants included) → the drugs the card names. A separate set from
// owner-queries.json (tools/benchmarks/cmp1-queries.json): each case says which drugs the card must
// name, or that no card may appear. Nothing is read from the instruction modules.
//
//   bun src/run-cmp1-queries.ts [--no-report] [--show]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { resolveDrugName } from '../../../apps/app/src/features/drug-comparison/comparison-candidates';
import { parseComparisonQuery } from '../../../apps/app/src/features/drug-comparison/comparison-query';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const show = args.includes('--show');

interface Case {
  readonly id: string;
  readonly kind: 'or' | 'vs' | 'cue' | 'negative';
  readonly query: string;
  /** Card slugs the card must name, in order; null: no card may appear. */
  readonly drugs: readonly string[] | null;
  /** false: the parser itself must refuse the query. */
  readonly parse?: boolean;
}

const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/cmp1-queries.json'), 'utf8'),
) as { readonly queries: readonly Case[] };
if (new Set(fixture.queries.map((item) => item.id)).size !== fixture.queries.length) {
  throw new Error('CMP1 query set contains duplicate ids.');
}
const { core } = await openRealCorpus({});

/** The card's own rule (`ComparisonSuggestionCard`): every name is a drug, at least two distinct. */
async function cardFor(names: readonly string[]): Promise<readonly string[] | null> {
  const found = await Promise.all(names.map((name) => resolveDrugName(core, name)));
  const drugs: { slug: string; product: string | null }[] = [];
  for (const drug of found) {
    if (
      drug &&
      !drugs.some((entry) => entry.slug === drug.slug && entry.product === drug.product)
    ) {
      drugs.push(drug);
    }
  }
  return drugs.length >= 2 && drugs.length === names.length ? drugs.map((drug) => drug.slug) : null;
}

interface Row {
  readonly id: string;
  readonly kind: Case['kind'];
  readonly query: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly got: readonly string[] | null;
  readonly ms: number;
}
const rows: Row[] = [];
for (const item of fixture.queries) {
  const failures: string[] = [];
  const started = performance.now();
  const parsed = parseComparisonQuery(item.query);
  let got: readonly string[] | null = null;
  if (item.parse === false) {
    if (parsed !== null) failures.push(`parsed: ${JSON.stringify(parsed.names)}`);
  } else if (!parsed) {
    if (item.drugs !== null) failures.push('not parsed');
  } else {
    got = await cardFor(parsed.names);
    if (item.drugs === null) {
      if (got !== null) failures.push(`card appears: ${JSON.stringify(got)}`);
    } else if (JSON.stringify(got) !== JSON.stringify(item.drugs)) {
      failures.push(`card ${JSON.stringify(got)} ≠ ${JSON.stringify(item.drugs)}`);
    }
  }
  rows.push({
    id: item.id,
    kind: item.kind,
    query: item.query,
    passed: failures.length === 0,
    failures,
    got,
    ms: Math.round(performance.now() - started),
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
  total: rows.length,
  passed: rows.filter((row) => row.passed).length,
  byKind: Object.fromEntries(byKind),
  slowestMs: Math.max(...rows.map((row) => row.ms)),
};
if (!args.includes('--no-report')) {
  const reportPath = resolve(REPOSITORY_ROOT, 'data/build/cmp1-queries-report.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
}
console.log(JSON.stringify(summary, null, 2));
for (const row of rows) {
  console.log(
    `${row.passed ? 'ok  ' : 'FAIL'}\t${row.kind}\t${row.id}\t${row.query}\t→ ${row.got?.join(' | ') ?? '-'}\t${row.ms} ms`,
  );
  for (const failure of row.failures) console.log(`      ! ${failure}`);
  void show;
}
