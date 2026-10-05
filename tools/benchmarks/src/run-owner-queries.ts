// The owner's own query set (tools/benchmarks/owner-queries.json) on the real corpus, through the
// app's «Все источники» lexical lookup path, reported separately for hurried and careful queries.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
for (const arg of args) {
  if (!/^--core=.+$/u.test(arg)) throw new Error(`Unknown argument ${arg}`);
}
const corePathOverride = args.find((arg) => arg.startsWith('--core='))?.slice('--core='.length);

interface OwnerQuery {
  readonly id: string;
  /** «rush»: fragments, abbreviations, typos, codes; «thoughtful»: a full case or question. */
  readonly style: 'rush' | 'thoughtful';
  readonly intent: string;
  readonly query: string;
  /** Any of these targets in the top five counts as found. */
  readonly expectedTargets: readonly string[];
  /** None of these may appear in the top five. */
  readonly forbiddenTargets: readonly string[];
}

const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/owner-queries.json'), 'utf8'),
) as { readonly queries: readonly OwnerQuery[] };
const cases = fixture.queries;
if (new Set(cases.map((item) => item.id)).size !== cases.length)
  throw new Error('Owner query set contains duplicate ids.');

const reportPath = resolve(REPOSITORY_ROOT, 'data/build/owner-queries-report.json');
const { core, corpus, target } = await openRealCorpus({ corePath: corePathOverride });
const scoped = new ScopedMedicalCore(core, 'all');
const rows = [];
for (const item of cases) {
  const started = performance.now();
  const response = await scoped.search({
    query: item.query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  const milliseconds = performance.now() - started;
  if (!response.ok) throw new Error(`${item.id}: ${response.error.message}`);
  const top = response.value.groups.slice(0, 5).map((group) => target(group.documentId));
  const rankIndex = top.findIndex((id) => item.expectedTargets.includes(id));
  rows.push({
    id: item.id,
    style: item.style,
    intent: item.intent,
    query: item.query,
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    hitAt1: rankIndex === 0,
    hitAt5: rankIndex >= 0,
    reciprocalRank: rankIndex >= 0 ? 1 / (rankIndex + 1) : 0,
    forbidden: top.filter((id) => item.forbiddenTargets.includes(id)),
    milliseconds: Math.round(milliseconds),
    top,
  });
}
await core.close();

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const summarize = (subset: typeof rows) => ({
  queryCount: subset.length,
  hitAt1: mean(subset.map((row) => Number(row.hitAt1))),
  hitAt5: mean(subset.map((row) => Number(row.hitAt5))),
  mrrAt5: mean(subset.map((row) => row.reciprocalRank)),
  forbiddenFreeRate: mean(subset.map((row) => Number(row.forbidden.length === 0))),
});
const summary = {
  corpus,
  all: summarize(rows),
  rush: summarize(rows.filter((row) => row.style === 'rush')),
  thoughtful: summarize(rows.filter((row) => row.style === 'thoughtful')),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
for (const row of rows) {
  console.log(`${row.rank ?? '-'}\t${row.style}\t${row.id}`);
}
