// Doctor phrasing on the real corpus, through the exact lookup path of the app: the «Все
// источники» scope and lexical lookup over core.db plus the companion packs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
for (const arg of args) {
  if (!/^--core=.+$/u.test(arg)) throw new Error(`Unknown argument ${arg}`);
}
const corePathOverride = args.find((arg) => arg.startsWith('--core='))?.slice('--core='.length);

interface DoctorLookupCase {
  readonly id: string;
  readonly query: string;
  /** Any of these targets in the top five counts as found. */
  readonly expectedTargets: readonly string[];
  /** None of these may appear in the top five. */
  readonly forbiddenTargets: readonly string[];
}

const reportPath = resolve(REPOSITORY_ROOT, 'data/build/doctor-lookup-report.json');
const cases = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/doctor-lookup-queries.json'), 'utf8'),
) as readonly DoctorLookupCase[];
if (new Set(cases.map((item) => item.id)).size !== cases.length)
  throw new Error('Doctor lookup fixture contains duplicate ids.');

const { core, corpus, target } = await openRealCorpus({ corePath: corePathOverride });
const scoped = new ScopedMedicalCore(core, 'all');
const rows = [];
for (const fixture of cases) {
  const response = await scoped.search({
    query: fixture.query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);
  const top = response.value.groups.slice(0, 5).map((group) => target(group.documentId));
  const rankIndex = top.findIndex((id) => fixture.expectedTargets.includes(id));
  const forbidden = top.filter((id) => fixture.forbiddenTargets.includes(id));
  rows.push({
    id: fixture.id,
    query: fixture.query,
    hitAt5: rankIndex >= 0,
    reciprocalRank: rankIndex >= 0 ? 1 / (rankIndex + 1) : 0,
    forbidden,
    top,
  });
}
await core.close();

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const summary = {
  corpus,
  queryCount: rows.length,
  recallAt5: mean(rows.map((row) => Number(row.hitAt5))),
  mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
  forbiddenFreeRate: mean(rows.map((row) => Number(row.forbidden.length === 0))),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(JSON.stringify({ summary, rows }, null, 2));
